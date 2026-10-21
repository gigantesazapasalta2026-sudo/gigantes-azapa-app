(function () {
  'use strict';

  var F = window.FufyPortal;
  var STORAGE_KEY = 'fufy-club-token-v1';
  var normalizeAccess = function (value) {
    return F && typeof F.normalizeAccessKey === 'function' ? F.normalizeAccessKey(value, 'club') : '';
  };
  var MAX_PLAYERS = 25;
  var MAX_FILE = 5 * 1024 * 1024;
  var pendingToken = '';
  var invalidFragment = false;
  if (typeof window.FUFY_INITIAL_ACCESS === 'string') {
    pendingToken = normalizeAccess(window.FUFY_INITIAL_ACCESS);
    invalidFragment = !pendingToken;
    delete window.FUFY_INITIAL_ACCESS;
  }

  // Remove invitation credentials before any API call or external navigation.
  try {
    var fragment = new URLSearchParams(window.location.hash.slice(1));
    if (fragment.has('acceso') || fragment.has('access')) {
      pendingToken = normalizeAccess(fragment.has('acceso') ? fragment.get('acceso') : fragment.get('access'));
      invalidFragment = !pendingToken;
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  } catch (ignore) {
    pendingToken = '';
  }

  var $ = function (id) { return document.getElementById(id); };
  var state = {
    token: '', snapshot: null, busy: false, gridBusy: false, clubDirty: false,
    playerDirty: false, rowDirtyCount: 0, playerContext: null
  };
  var delegationFields = [
    'club_city', 'club_country', 'delegate_name', 'delegate_email', 'delegate_phone', 'manager_name',
    'manager_phone', 'captain_name', 'first_aid_name', 'first_aid_phone', 'club_notes'
  ];
  var delegationFlags = ['accepted_bases', 'confirmed_accuracy', 'privacy_consent'];
  var playerFields = ['emergency_contact', 'emergency_phone', 'notes'];
  var documentLabels = {
    signed_roster: 'Nómina y declaraciones firmadas',
    manager_declaration: 'Declaración del manager',
    player_declaration: 'Declaración de jugador',
    insurance: 'Seguro / respaldo de cobertura',
    federation: 'Inscripción federativa',
    identity: 'Documento de identidad',
    other: 'Otro antecedente'
  };
  var federationLabels = {
    pending: 'Pendiente / por confirmar',
    declared: 'Inscripción declarada',
    not_applicable: 'No aplica / federación de origen'
  };
  var coverageLabels = {
    pending: 'Por informar', insurance: 'Seguro declarado',
    prevision: 'Previsión declarada', other: 'Otro medio declarado'
  };

  function setMessage(message, kind) {
    var box = $('fp-message');
    box.textContent = message || '';
    box.className = 'fp-message' + (kind ? ' fp-message--' + kind : '');
    box.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    box.hidden = !message;
  }

  if (!F || typeof F.normalizeAccessKey !== 'function' || !window.FufyRosterGrid) {
    setMessage('No se pudo cargar el acceso a las nóminas. Recarga esta página. Los enlaces informativos de Chile Rugby siguen disponibles abajo.', 'error');
    $('fp-access-form').querySelector('button').disabled = true;
    return;
  }

  var esc = F.esc;
  var dialog = $('fp-player-dialog');
  var rosterGrid = null;

  function players() {
    return state.snapshot && Array.isArray(state.snapshot.players) ? state.snapshot.players : [];
  }

  function documents() {
    return state.snapshot && Array.isArray(state.snapshot.documents) ? state.snapshot.documents : [];
  }

  function isReadOnly() {
    return Boolean(state.snapshot && state.snapshot.access && state.snapshot.access.read_only);
  }

  function closeReason() {
    return state.snapshot && state.snapshot.access && state.snapshot.access.reason
      ? state.snapshot.access.reason
      : 'La recepción de nóminas está cerrada. Puedes consultar y descargar tus antecedentes.';
  }

  function canWrite() {
    if (!state.snapshot || !state.token) return false;
    if (isReadOnly()) {
      setMessage(closeReason(), 'warning');
      return false;
    }
    return !state.busy && !state.gridBusy;
  }

  function updateDirty() {
    var messages = [];
    if (state.clubDirty) messages.push('Datos de la delegación sin guardar.');
    if (state.rowDirtyCount) messages.push(state.rowDirtyCount + (state.rowDirtyCount === 1 ? ' fila de jugador sin guardar.' : ' filas de jugadores sin guardar.'));
    $('fp-unsaved').textContent = messages.length ? messages.join(' ') : 'Sin cambios pendientes.';
    $('fp-unsaved').className = messages.length ? 'fp-small fp-age-alert' : 'fp-small fp-muted';
  }

  function syncDocumentTarget() {
    var wholeClub = ['signed_roster', 'manager_declaration'].includes($('fp-document-kind').value);
    var selector = $('fp-document-player');
    if (wholeClub) selector.value = '';
    selector.disabled = wholeClub || state.busy || state.gridBusy || isReadOnly();
  }

  function syncActions() {
    var locked = state.busy || state.gridBusy || isReadOnly();
    document.querySelectorAll('[data-fp-write]').forEach(function (button) {
      button.disabled = locked;
    });
    document.querySelectorAll('.fp-mutable').forEach(function (fieldset) {
      fieldset.disabled = locked;
    });
    $('fp-add-player').disabled = locked || players().length >= MAX_PLAYERS;
    $('fp-add-player').textContent = players().length >= MAX_PLAYERS
      ? 'Plantel completo · 25/25'
      : 'Ir a una fila vacía';
    $('fp-csv').disabled = state.busy || state.gridBusy || !players().length;
    $('fp-print-roster').disabled = state.busy || state.gridBusy || !players().length;
    $('fp-reload').disabled = state.busy || state.gridBusy;
    $('fp-logout').disabled = state.busy || state.gridBusy;
    var status = state.snapshot && state.snapshot.submission && state.snapshot.submission.status;
    $('fp-submit').textContent = status === 'submitted' || status === 'observed'
      ? 'Volver a enviar a revisión'
      : 'Enviar nómina a revisión';
    $('fp-read-only').hidden = !isReadOnly();
    $('fp-read-only').textContent = isReadOnly() ? closeReason() : '';
    if (rosterGrid && (rosterGrid.disabled !== state.busy || rosterGrid.readOnly !== isReadOnly())) {
      rosterGrid.setData({ disabled: state.busy, readOnly: isReadOnly() });
    }
    syncDocumentTarget();
    updateDirty();
  }

  async function runOperation(fn, options) {
    if (state.busy || state.gridBusy) return null;
    options = options || {};
    state.busy = true;
    if (rosterGrid) rosterGrid.setData({ disabled: true });
    document.body.classList.add('fp-loading');
    $('fp-main').setAttribute('aria-busy', 'true');
    var controls = Array.from(document.querySelectorAll('button, fieldset')).map(function (el) {
      var previous = el.disabled;
      el.disabled = true;
      return [el, previous];
    });
    var button = options.button;
    var oldText = button ? button.textContent : '';
    if (button) button.textContent = options.working || 'Procesando…';
    if (options.errorTarget) {
      options.errorTarget.hidden = true;
      options.errorTarget.textContent = '';
    }
    try {
      var result = await fn();
      if (options.success) setMessage(options.success, 'success');
      return result;
    } catch (error) {
      var message = error && error.message ? error.message : 'No se pudo completar la operación. Inténtalo de nuevo.';
      if (error && error.status === 409) {
        message += ' Actualiza la nómina antes de volver a guardar; conserva primero cualquier cambio que tengas pendiente.';
      }
      setMessage(message, 'error');
      if (options.errorTarget) {
        options.errorTarget.textContent = message;
        options.errorTarget.hidden = false;
        options.errorTarget.scrollIntoView({ block: 'nearest' });
      } else {
        $('fp-message').scrollIntoView({ block: 'nearest' });
      }
      return null;
    } finally {
      controls.forEach(function (entry) {
        if (entry[0].isConnected) entry[0].disabled = entry[1];
      });
      if (button && button.isConnected) button.textContent = oldText;
      state.busy = false;
      document.body.classList.remove('fp-loading');
      $('fp-main').removeAttribute('aria-busy');
      syncActions();
    }
  }

  function call(action, payload) {
    return F.request(action, payload || {}, { token: state.token });
  }

  function dateText(value) {
    return value ? F.formatDate(value) : 'Por informar';
  }

  function timestamp(value) {
    if (!value) return '';
    var d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('es-CL', {
      timeZone: 'America/Santiago', dateStyle: 'short', timeStyle: 'short'
    });
  }

  function ageEvent(value) {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    var age = F.ageOnEvent(value);
    return typeof age === 'number' && Number.isFinite(age) ? age : null;
  }

  function ageYear(value) {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    var age = 2026 - Number(value.slice(0, 4));
    return Number.isFinite(age) && age >= 0 ? age : null;
  }

  function ageText(value) {
    var atEvent = ageEvent(value);
    var inYear = ageYear(value);
    if (atEvent === null || inYear === null) return 'Fecha por informar';
    return atEvent + ' al torneo · ' + inYear + ' en 2026';
  }

  function statusClass(value) {
    return ['draft', 'submitted', 'observed', 'approved', 'pending', 'reviewed'].includes(value)
      ? ' fp-status--' + value : '';
  }

  function statusBadge(value) {
    return '<span class="fp-status' + statusClass(value) + '">' + esc(F.statusLabel(value || 'pending')) + '</span>';
  }

  function getField(form, name) {
    return form.elements.namedItem(name);
  }

  function fillDelegation(data) {
    var form = $('fp-delegation-form');
    var team = state.snapshot && state.snapshot.team ? state.snapshot.team : {};
    delegationFields.forEach(function (name) {
      var value = data[name] == null ? '' : String(data[name]);
      if (!value.trim() && name === 'club_city') value = team.city || '';
      if (!value.trim() && name === 'club_country') value = team.country || '';
      getField(form, name).value = value;
    });
    delegationFlags.forEach(function (name) {
      getField(form, name).checked = data[name] === true;
    });
  }

  function collectDelegation() {
    var form = $('fp-delegation-form');
    var data = {};
    delegationFields.forEach(function (name) {
      data[name] = getField(form, name).value.trim();
    });
    delegationFlags.forEach(function (name) {
      data[name] = getField(form, name).checked;
    });
    return data;
  }

  function applySnapshot(snapshot, options) {
    options = options || {};
    if (!snapshot || !snapshot.team || !Array.isArray(snapshot.players)) {
      throw new Error('La respuesta de la nómina está incompleta. Vuelve a actualizar.');
    }
    state.snapshot = snapshot;
    var submission = snapshot.submission || {};
    $('fp-access').hidden = true;
    $('fp-workspace').hidden = false;
    $('fp-team-name').textContent = snapshot.team.name || 'Mi club';
    $('fp-team-place').textContent = [snapshot.team.city, snapshot.team.country].filter(Boolean).join(' · ');
    $('fp-team-status').textContent = F.statusLabel(submission.status || 'draft');
    $('fp-team-status').className = 'fp-status' + statusClass(submission.status || 'draft');
    $('fp-saved-at').textContent = submission.updated_at
      ? 'Último guardado: ' + timestamp(submission.updated_at)
      : '';
    $('fp-submitted-at').textContent = submission.submitted_at
      ? 'Último envío: ' + timestamp(submission.submitted_at)
      : '';
    if (!state.clubDirty || options.forceDelegation) fillDelegation(submission);
    $('fp-player-count').textContent = players().length + '/' + MAX_PLAYERS;
    renderPlayers();
    renderDocuments();
    renderChecks();
    syncActions();
  }

  function renderPlayers() {
    if (!rosterGrid) {
      rosterGrid = window.FufyRosterGrid.create($('fp-player-list'), {
        players: players(), team: state.snapshot.team, readOnly: isReadOnly(), disabled: state.busy,
        onSave: async function (player, expectedUpdatedAt) {
          if (state.busy || isReadOnly()) throw new Error(closeReason());
          var payload = { player: player };
          if (expectedUpdatedAt) payload.expected_updated_at = expectedUpdatedAt;
          return call('save_player', payload);
        },
        onDelete: async function (player) {
          if (state.busy || isReadOnly()) throw new Error(closeReason());
          return call('delete_player', { player_id: player.id, expected_updated_at: player.updated_at });
        },
        onMore: openPlayerDetails,
        onDocuments: function (player) {
          if (isReadOnly()) $('fp-documents').scrollIntoView({ block: 'start', behavior: 'smooth' });
          else preparePlayerDocument(player.id);
        },
        onSnapshot: function (snapshot) {
          applySnapshot(snapshot);
          setMessage('Nómina guardada. Revisa los antecedentes y las firmas que deban actualizarse. Las demás filas conservan sus cambios pendientes.', 'success');
        },
        onDirtyChange: function (count) {
          state.rowDirtyCount = count;
          updateDirty();
        },
        onBusyChange: function (busy) {
          state.gridBusy = busy;
          syncActions();
        },
        onError: function (message) { setMessage(message, 'error'); }
      });
    } else {
      rosterGrid.setData({ players: players(), team: state.snapshot.team, readOnly: isReadOnly(), disabled: state.busy });
    }
  }

  function bytesText(bytes) {
    var amount = Number(bytes);
    if (!Number.isFinite(amount) || amount < 0) return '';
    return amount >= 1024 * 1024 ? (amount / (1024 * 1024)).toFixed(1) + ' MiB' : Math.max(1, Math.round(amount / 1024)) + ' KiB';
  }

  function renderDocuments() {
    var selector = $('fp-document-player');
    var selected = selector.value;
    selector.innerHTML = '<option value="">Todo el club</option>' + players().map(function (player) {
      return '<option value="' + esc(player.id) + '">' + esc(player.full_name) + '</option>';
    }).join('');
    if (players().some(function (p) { return p.id === selected; })) selector.value = selected;
    $('fp-document-count').textContent = documents().length + (documents().length === 1 ? ' archivo' : ' archivos');
    var list = $('fp-document-list');
    if (!documents().length) {
      list.innerHTML = '<div class="fp-empty"><strong>Aún no hay documentos adjuntos</strong><p>Puedes cargar un archivo que reúna la nómina y declaraciones firmadas, o los respaldos firmados por separado.</p></div>';
      return;
    }
    list.innerHTML = '<div class="fp-documents-list">' + documents().map(function (doc) {
      var person = doc.player_id ? players().find(function (p) { return p.id === doc.player_id; }) : null;
      var belongs = doc.player_id ? (person ? person.full_name : 'Jugador de la nómina') : 'Todo el club';
      var detail = [documentLabels[doc.kind] || 'Documento', belongs, bytesText(doc.size_bytes), timestamp(doc.created_at)].filter(Boolean).join(' · ');
      return '<article class="fp-document"><div><strong>' + esc(doc.file_name || 'Archivo adjunto') + '</strong><small>' + esc(detail) + '</small>' +
        (doc.is_current === false ? '<span class="fp-status fp-status--stale">Reemplazar por versión actual</span>' : '') +
        '</div><div class="fp-toolbar"><button type="button" class="fp-btn fp-btn--secondary fp-btn--small" data-action="open-document" data-document-id="' + esc(doc.id) + '">Ver archivo</button>' +
        '<button type="button" class="fp-btn fp-btn--danger fp-btn--small" data-fp-write data-action="delete-document" data-document-id="' + esc(doc.id) + '"' + (isReadOnly() ? ' disabled' : '') + '>Quitar</button></div></article>';
    }).join('') + '</div>';
  }

  function checkText(item) {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object') return item.message || item.label || item.text || 'Antecedente pendiente de revisión';
    return 'Antecedente pendiente de revisión';
  }

  function checklistBlock(title, items) {
    return '<div class="fp-checklist-block"><h3>' + esc(title) + '</h3><ul>' + items.map(function (item) {
      return '<li>' + esc(checkText(item)) + '</li>';
    }).join('') + '</ul></div>';
  }

  function renderChecks() {
    var checks = state.snapshot.checks || {};
    var missing = Array.isArray(checks.missing) ? checks.missing : [];
    var warnings = Array.isArray(checks.warnings) ? checks.warnings : [];
    var html = '';
    if (missing.length) html += checklistBlock('Antecedentes por completar · ' + missing.length, missing);
    if (warnings.length) html += checklistBlock('Puntos que revisará la organización · ' + warnings.length, warnings);
    if (!missing.length && checks.complete === true) {
      html = '<div class="fp-checklist-block fp-checklist-block--ready"><h3>Antecedentes de la lista completos</h3><p>La organización revisará la documentación y cualquier observación antes de la acreditación.</p></div>' + html;
    }
    if (!html) {
      html = '<div class="fp-checklist-block"><h3>Expediente en preparación</h3><p>Completa y guarda la delegación, los jugadores y sus documentos para actualizar esta lista.</p></div>';
    }
    $('fp-checklist').innerHTML = html;
    var note = (state.snapshot.submission || {}).review_note;
    $('fp-review-note').hidden = !note;
    $('fp-review-note').textContent = note ? 'Observaciones de la organización: ' + note : '';
  }

  function parseAccess(value) {
    return normalizeAccess(value);
  }

  function storeToken(token) {
    try { sessionStorage.setItem(STORAGE_KEY, token); } catch (ignore) { /* Memory-only access still works. */ }
  }

  function forgetToken() {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch (ignore) { /* No persistent fallback. */ }
  }

  async function enterClub(token, button) {
    await runOperation(async function () {
      var snapshot;
      try {
        snapshot = await F.request('open', {}, { token: token });
      } catch (error) {
        if (error && (error.status === 401 || error.status === 403)) forgetToken();
        throw error;
      }
      state.token = token;
      state.clubDirty = false;
      state.playerDirty = false;
      applySnapshot(snapshot, { forceDelegation: true });
      storeToken(token);
      $('fp-access-code').value = '';
      setMessage('', '');
      $('fp-team-name').focus({ preventScroll: true });
      return snapshot;
    }, { button: button, working: 'Abriendo mi club…' });
  }

  function resetAccess() {
    forgetToken();
    state.token = '';
    state.snapshot = null;
    state.clubDirty = false;
    state.playerDirty = false;
    state.playerContext = null;
    state.gridBusy = false;
    state.rowDirtyCount = 0;
    if (rosterGrid) rosterGrid.destroy();
    rosterGrid = null;
    if (dialog.open) dialog.close();
    $('fp-delegation-form').reset();
    $('fp-player-form').reset();
    $('fp-upload-form').reset();
    $('fp-player-list').textContent = '';
    $('fp-document-list').textContent = '';
    $('fp-checklist').textContent = '';
    $('fp-team-name').textContent = '';
    $('fp-team-place').textContent = '';
    $('fp-print').textContent = '';
    $('fp-access-code').value = '';
    $('fp-access').hidden = false;
    $('fp-workspace').hidden = true;
    syncActions();
    setMessage('Acceso cerrado en esta pestaña.', 'success');
    $('fp-access-code').focus({ preventScroll: false });
  }

  async function saveDelegationData(data) {
    var snapshot = await call('save_submission', {
      data: data,
      expected_updated_at: (state.snapshot.submission || {}).updated_at || null
    });
    state.clubDirty = false;
    applySnapshot(snapshot, { forceDelegation: true });
    return snapshot;
  }

  function openPlayerDetails(player, context) {
    if (!state.snapshot || state.busy || state.gridBusy) return;
    var form = $('fp-player-form');
    form.reset();
    state.playerContext = context;
    playerFields.forEach(function (name) {
      var field = getField(form, name);
      field.value = player[name] == null ? '' : String(player[name]);
    });
    getField(form, 'signature_declared').checked = player.signature_declared === true;
    state.playerDirty = false;
    $('fp-player-error').hidden = true;
    $('fp-player-error').textContent = '';
    $('fp-player-dialog-title').textContent = 'Más datos · Fila ' + context.rowNumber;
    $('fp-player-summary').textContent = [player.full_name || 'Jugador por completar',
      player.document_number ? (player.document_type || 'Documento') + ' ' + player.document_number : '',
      player.birth_date ? ageText(player.birth_date) : ''].filter(Boolean).join(' · ');
    form.hidden = context.readOnly;
    var details = $('fp-player-readonly');
    details.hidden = !context.readOnly;
    details.innerHTML = context.readOnly ? '<dl><dt>Contacto de emergencia</dt><dd>' + esc(player.emergency_contact || 'Por informar') +
      '</dd><dt>Teléfono de emergencia</dt><dd>' + esc(player.emergency_phone || 'Por informar') +
      '</dd><dt>Observaciones de inscripción</dt><dd>' + esc(player.notes || 'Sin observaciones') +
      '</dd><dt>Firma declarada</dt><dd>' + (player.signature_declared ? 'Sí · requiere documento firmado' : 'Pendiente') +
      '</dd><dt>Revisión de la organización</dt><dd>' + esc(F.statusLabel(player.review_status || 'pending')) +
      (player.review_note ? ' · ' + esc(player.review_note) : '') + '</dd></dl>' : '';
    if (!context.readOnly && player.review_note) {
      $('fp-player-error').textContent = 'Observación de la organización: ' + player.review_note;
      $('fp-player-error').hidden = false;
    }
    syncActions();
    dialog.showModal();
    if (context.readOnly) $('fp-player-close').focus();
    else $('fp-player-emergency').focus();
  }

  function closePlayer() {
    if (state.busy || state.gridBusy) return;
    if (state.playerDirty && !window.confirm('¿Cerrar sin aplicar estos datos a la fila? Los demás cambios de la tabla se conservarán.')) return;
    state.playerDirty = false;
    state.playerContext = null;
    dialog.close();
    $('fp-player-form').reset();
  }

  function collectPlayer() {
    var form = $('fp-player-form');
    var data = {};
    playerFields.forEach(function (name) {
      data[name] = getField(form, name).value.trim();
    });
    data.signature_declared = getField(form, 'signature_declared').checked;
    return data;
  }

  function preparePlayerDocument(id) {
    if (!canWrite()) return;
    $('fp-document-kind').value = 'player_declaration';
    $('fp-document-player').value = id;
    syncDocumentTarget();
    $('fp-documents').scrollIntoView({ block: 'start', behavior: 'smooth' });
    $('fp-document-file').focus({ preventScroll: true });
  }

  async function openDocument(id, button) {
    if (state.busy || state.gridBusy || !state.snapshot) return;
    var previewWindow = window.open('about:blank', '_blank');
    if (previewWindow) {
      previewWindow.opener = null;
      previewWindow.document.title = 'Abriendo documento';
      previewWindow.document.body.textContent = 'Preparando el acceso al documento…';
    }
    var navigated = false;
    await runOperation(async function () {
      var result = await call('get_document', { document_id: id });
      var url = new URL(result.url);
      if (url.protocol !== 'https:') throw new Error('El enlace del documento no es válido.');
      if (previewWindow && !previewWindow.closed) {
        previewWindow.location.replace(url.href);
      } else {
        setMessage('Tu navegador bloqueó la nueva pestaña. Abre el documento con este enlace temporal: ', '');
        var link = document.createElement('a');
        link.href = url.href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'Abrir documento';
        $('fp-message').appendChild(link);
      }
      navigated = true;
    }, { button: button, working: 'Abriendo…' });
    if (!navigated && previewWindow && !previewWindow.closed) previewWindow.close();
  }

  async function removeDocument(id, button) {
    if (!canWrite()) return;
    var doc = documents().find(function (item) { return item.id === id; });
    if (!doc || !window.confirm('¿Quitar el archivo "' + doc.file_name + '" de los antecedentes de tu club?')) return;
    await runOperation(async function () {
      applySnapshot(await call('delete_document', { document_id: id }));
    }, { button: button, success: 'Documento retirado. La lista de pendientes fue actualizada.' });
  }

  function fileSlug(value) {
    return String(value || 'club').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'club';
  }

  function hasRowDrafts() {
    return Boolean(rosterGrid && rosterGrid.hasUnsavedChanges());
  }

  function requireSavedRoster(action) {
    if (!state.clubDirty && !hasRowDrafts()) return true;
    if (isReadOnly()) {
      setMessage('La nómina está cerrada. Esta descarga contiene la versión guardada; los cambios pendientes de esta pestaña no se incluyen.', 'warning');
      return true;
    }
    setMessage('Guarda los cambios de la delegación y cada fila pendiente antes de ' + action + ' la nómina.', 'warning');
    if (hasRowDrafts()) $('fp-players').scrollIntoView({ block: 'start' });
    else $('fp-delegation-form').querySelector('button[type=submit]').focus();
    return false;
  }

  function exportCSV() {
    if (!state.snapshot || !players().length || !requireSavedRoster('descargar')) return;
    var rows = [[
      'Club', 'Ciudad del club', 'País del club', 'N°', 'Nombre completo', 'Tipo de documento', 'Documento',
      'Fecha de nacimiento', 'Edad al 24/10/2026', 'Edad que cumple en 2026', 'Nacionalidad',
      'Camiseta', 'Registro federativo declarado', 'Medio de atención declarado',
      'Aseguradora / previsión / medio', 'Vigencia declarada hasta', 'Contacto de emergencia',
      'Teléfono de emergencia', 'Firma declarada por club', 'Revisión de organización',
      'Observación de organización', 'Observaciones de inscripción'
    ]];
    players().forEach(function (player, index) {
      rows.push([
        state.snapshot.team.name, state.snapshot.team.city || '', state.snapshot.team.country || '', index + 1, player.full_name || '',
        player.document_type || '', player.document_number || '', player.birth_date || '',
        ageEvent(player.birth_date) == null ? '' : ageEvent(player.birth_date),
        ageYear(player.birth_date) == null ? '' : ageYear(player.birth_date),
        player.nationality || '', player.jersey_number == null ? '' : player.jersey_number,
        federationLabels[player.federation_status] || federationLabels.pending,
        coverageLabels[player.coverage_type] || coverageLabels.pending,
        player.insurance_provider || '', player.insurance_valid_until || '',
        player.emergency_contact || '', player.emergency_phone || '',
        player.signature_declared ? 'Sí; requiere documento firmado' : 'Pendiente',
        F.statusLabel(player.review_status || 'pending'), player.review_note || '', player.notes || ''
      ]);
    });
    F.downloadCSV('Copa-FUFY-2026-' + fileSlug(state.snapshot.team.name) + '-nomina.csv', rows);
  }

  function printRoster() {
    if (!state.snapshot || !players().length || !requireSavedRoster('imprimir')) return;
    var team = state.snapshot.team;
    var data = state.snapshot.submission || {};
    var clubLogo = document.querySelector('.fp-club-logo').src;
    var cupLogo = document.querySelector('.fp-cup-logo').src;
    var rosterRows = players().map(function (player, index) {
      var ae = ageEvent(player.birth_date);
      var ay = ageYear(player.birth_date);
      return '<tr><td>' + (index + 1) + '</td><td><strong>' + esc(player.full_name || '') + '</strong>' +
        (player.jersey_number != null ? '<br>Camiseta: ' + esc(player.jersey_number) : '') +
        '</td><td>' + esc(player.document_type || '') + '<br>' + esc(player.document_number || 'Pendiente') +
        '</td><td>' + esc(dateText(player.birth_date)) + '</td><td>' +
        esc(ae === null ? '—' : ae) + ' / ' + esc(ay === null ? '—' : ay) + (ay !== null && ay < 40 ? ' *' : '') +
        '</td><td>' + esc(coverageLabels[player.coverage_type] || coverageLabels.pending) +
        (player.insurance_provider ? '<br>' + esc(player.insurance_provider) : '') +
        '</td><td aria-label="Espacio para firma"></td></tr>';
    }).join('');
    $('fp-print').innerHTML =
      '<header class="fp-print-header"><div><h1>Copa FUFY 2026 · Nómina de jugadores</h1><p><strong>' + esc(team.name) +
      '</strong> · ' + esc([team.city, team.country].filter(Boolean).join(', ')) +
      '</p><p>Sábado 24 de octubre de 2026 · Estadio Carlos Dittborn, Arica</p><p>Nómina para firma y revisión · ' +
      players().length + ' jugadores · Estado del expediente: ' + esc(F.statusLabel(data.status || 'draft')) +
      '</p></div><div class="fp-print-logos"><img src="' + esc(clubLogo) + '" alt="Gigantes de Azapa"><img src="' + esc(cupLogo) + '" alt="Copa FUFY"></div></header>' +
      '<div class="fp-print-info"><div><strong>Delegado:</strong> ' + esc(data.delegate_name || '________________________') +
      '</div><div><strong>Contacto:</strong> ' + esc(data.delegate_phone || data.delegate_email || '________________________') +
      '</div><div><strong>Manager:</strong> ' + esc(data.manager_name || '________________________') +
      '</div><div><strong>Teléfono del manager:</strong> ' + esc(data.manager_phone || '________________________') +
      '</div><div><strong>Capitán:</strong> ' + esc(data.captain_name || '________________________') +
      '</div><div><strong>Primeros auxilios:</strong> ' + esc(data.first_aid_name || '________________________') +
      '</div><div><strong>Teléfono:</strong> ' + esc(data.first_aid_phone || '________________________') + '</div></div>' +
      '<p class="fp-print-intro"><strong>Declaración de cada jugador.</strong> Al firmar junto a mi nombre, declaro haber leído las bases de la Copa FUFY 2026, conocer los riesgos propios de la práctica del rugby como deporte de contacto y confirmar que los datos de identidad consignados en esta nómina son correctos.</p>' +
      '<table class="fp-print-table"><thead><tr><th class="fp-col-number">N°</th><th class="fp-col-name">Nombre completo</th><th class="fp-col-document">Identidad</th><th class="fp-col-birth">Nacimiento</th><th class="fp-col-age">Edad torneo / 2026</th><th class="fp-col-coverage">Medio de atención declarado</th><th class="fp-col-sign">Firma del jugador</th></tr></thead><tbody>' +
      rosterRows + '</tbody></table>' +
      '<p class="fp-print-footnote">Edad torneo: años cumplidos al 24/10/2026. Edad 2026: años que cumple durante el año. * Caso menor de 40 años sujeto a revisión por la organización. Los medios de atención corresponden a lo declarado por el club y deben respaldarse según corresponda.</p>' +
      '<section class="fp-print-declaration"><h2>Declaración y firma del manager</h2><p>Yo, <strong>' +
      esc(data.manager_name || '________________________________________') + '</strong>, en representación de <strong>' +
      esc(team.name) + '</strong>, declaro que he verificado la identidad y la veracidad de los datos de los integrantes incluidos en esta nómina, y que he comunicado las bases del torneo y los riesgos propios de la práctica del rugby a la delegación. Me comprometo a respetar el criterio de edad ratificado y comunicado por la organización.</p>' +
      '<p>Los antecedentes se presentan a la organización para su revisión. Este documento no constituye por sí solo un certificado de cobertura ni de aptitud médica.</p>' +
      '<div class="fp-print-signatures"><div>Firma del manager · Documento de identidad</div><div>Lugar y fecha</div></div>' +
      '<div class="fp-print-signatures"><div>Recepción mesa de control · Nombre y firma</div><div>Fecha y hora de recepción</div></div></section>' +
      '<p class="fp-print-footer">Documento preparado desde el portal de clubes de Copa FUFY. Una vez firmado, adjúntalo como «Nómina y declaraciones firmadas» en el acceso privado de tu club.</p>';
    window.print();
  }

  $('fp-access-form').addEventListener('submit', function (event) {
    event.preventDefault();
    if (state.busy) return;
    var token = parseAccess($('fp-access-code').value);
    if (!token) {
      setMessage('Ingresa la clave FUFY de tu club o pega su enlace privado completo. Puedes escribir la clave con o sin guiones.', 'error');
      $('fp-access-code').focus();
      return;
    }
    enterClub(token, event.submitter);
  });

  $('fp-logout').addEventListener('click', function () {
    if (state.busy || state.gridBusy) return;
    if ((state.clubDirty || state.playerDirty || hasRowDrafts()) && !window.confirm('Tienes cambios sin guardar. ¿Cerrar el acceso y descartarlos?')) return;
    resetAccess();
  });

  $('fp-reload').addEventListener('click', async function (event) {
    await runOperation(async function () {
      var snapshot = await call('open');
      applySnapshot(snapshot);
    }, { button: event.currentTarget, success: 'Nómina actualizada. Se conservaron los cambios sin guardar de esta pestaña.' });
  });

  $('fp-delegation-form').addEventListener('input', function () {
    state.clubDirty = true;
    updateDirty();
  });
  $('fp-delegation-form').addEventListener('change', function () {
    state.clubDirty = true;
    updateDirty();
  });
  $('fp-delegation-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    if (!canWrite() || !$('fp-delegation-form').reportValidity()) return;
    var data = collectDelegation();
    await runOperation(function () { return saveDelegationData(data); }, {
      button: event.submitter, working: 'Guardando…', success: 'Datos de la delegación guardados.'
    });
  });

  $('fp-add-player').addEventListener('click', function () {
    if (canWrite() && rosterGrid) rosterGrid.focusEmptyRow();
  });
  $('fp-player-close').addEventListener('click', closePlayer);
  $('fp-player-cancel').addEventListener('click', closePlayer);
  dialog.addEventListener('cancel', function (event) {
    event.preventDefault();
    closePlayer();
  });
  $('fp-player-form').addEventListener('input', function () {
    state.playerDirty = true;
  });
  $('fp-player-form').addEventListener('change', function () {
    state.playerDirty = true;
  });
  $('fp-player-form').addEventListener('submit', function (event) {
    event.preventDefault();
    if (!canWrite() || !state.playerContext || !$('fp-player-form').reportValidity()) return;
    var context = state.playerContext;
    if (!context.update(collectPlayer())) {
      $('fp-player-error').textContent = 'No se pudieron aplicar los datos. Cierra esta ventana y vuelve a abrir los datos de la fila.';
      $('fp-player-error').hidden = false;
      return;
    }
    state.playerDirty = false;
    closePlayer();
    setMessage('Datos aplicados a la fila ' + context.rowNumber + '. Pulsa Guardar fila en la tabla para guardarlos en la nómina.', 'warning');
  });

  $('fp-document-kind').addEventListener('change', syncDocumentTarget);

  $('fp-upload-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    if (!canWrite()) return;
    syncDocumentTarget();
    var file = $('fp-document-file').files[0];
    if (!file) {
      $('fp-document-file').reportValidity();
      return;
    }
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) {
      setMessage('Selecciona un archivo PDF, JPG o PNG.', 'error');
      return;
    }
    if (!file.size || file.size > MAX_FILE) {
      setMessage('El archivo debe tener contenido y no superar los 5 MiB.', 'error');
      return;
    }
    if ($('fp-document-kind').value === 'player_declaration' && !$('fp-document-player').value) {
      setMessage('Selecciona al jugador al que corresponde esta declaración firmada.', 'error');
      $('fp-document-player').focus();
      return;
    }
    var form = new FormData();
    form.set('action', 'upload_document');
    form.set('kind', $('fp-document-kind').value);
    form.set('expected_updated_at', (state.snapshot.submission || {}).updated_at || '');
    if ($('fp-document-player').value) form.set('player_id', $('fp-document-player').value);
    form.set('file', file);
    await runOperation(async function () {
      var snapshot = await F.upload(form, { token: state.token });
      $('fp-document-file').value = '';
      applySnapshot(snapshot);
    }, { button: event.submitter, working: 'Subiendo documento…', success: 'Documento guardado. La organización podrá revisarlo en el expediente de tu club.' });
  });

  $('fp-submit').addEventListener('click', async function (event) {
    if (!canWrite()) return;
    if (hasRowDrafts()) {
      setMessage('Hay filas de jugadores sin guardar. Pulsa Guardar fila en cada una antes de enviar la nómina.', 'warning');
      $('fp-players').scrollIntoView({ block: 'start' });
      return;
    }
    if (!$('fp-delegation-form').reportValidity()) {
      $('fp-delegation').scrollIntoView({ block: 'start' });
      return;
    }
    var data = collectDelegation();
    var needsSave = state.clubDirty;
    await runOperation(async function () {
      if (needsSave) await saveDelegationData(data);
      applySnapshot(await call('submit', {
        expected_updated_at: (state.snapshot.submission || {}).updated_at || null
      }));
      $('fp-review').scrollIntoView({ block: 'start' });
    }, { button: event.currentTarget, working: 'Enviando…', success: 'Nómina enviada a revisión. Consulta aquí las observaciones de la organización antes de la acreditación.' });
  });

  $('fp-workspace').addEventListener('click', function (event) {
    var button = event.target.closest('button[data-action]');
    if (!button || button.disabled || state.busy || state.gridBusy) return;
    var action = button.dataset.action;
    if (action === 'open-document') openDocument(button.dataset.documentId, button);
    if (action === 'delete-document') removeDocument(button.dataset.documentId, button);
  });
  $('fp-csv').addEventListener('click', exportCSV);
  $('fp-print-roster').addEventListener('click', printRoster);
  window.addEventListener('afterprint', function () { $('fp-print').textContent = ''; });
  window.addEventListener('beforeunload', function (event) {
    if (state.clubDirty || state.playerDirty || hasRowDrafts()) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  function applyLinks() {
    var constants = F.constants || {};
    var names = {
      bases: constants.basesUrl, rugbyRegister: constants.rugbyRegister,
      rugbyLogin: constants.rugbyLogin, rugbyInfo: constants.rugbyInfo
    };
    document.querySelectorAll('[data-fp-link]').forEach(function (link) {
      var value = names[link.dataset.fpLink];
      if (!value) return;
      try {
        var url = new URL(value);
        if (url.protocol === 'https:') link.href = url.href;
      } catch (ignore) { /* Keep the verified static fallback. */ }
    });
  }

  async function loadPublicInfo() {
    try {
      var info = await F.request('public_info');
      $('fp-public-teams').innerHTML = (Array.isArray(info.teams) ? info.teams : []).map(function (team) {
        return '<span class="fp-chip">' + esc(team.name) + '</span>';
      }).join('');
    } catch (ignore) {
      $('fp-public-teams').textContent = 'Copa FUFY · Clubes invitados';
    }
  }

  applyLinks();
  syncActions();
  loadPublicInfo();
  if (!pendingToken && !invalidFragment) {
    try { pendingToken = sessionStorage.getItem(STORAGE_KEY) || ''; } catch (ignore) { /* Memory only. */ }
  }
  pendingToken = normalizeAccess(pendingToken);
  if (pendingToken) enterClub(pendingToken, null);
  else if (invalidFragment) setMessage('La clave del enlace está incompleta o no es válida. Ingresa la clave del club o pega el enlace completo recibido de la organización.', 'error');
})();
