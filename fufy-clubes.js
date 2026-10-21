(function () {
  'use strict';

  var STORAGE_KEY = 'fufy-club-token-v1';
  var TOKEN_RE = /^[a-f0-9]{64}$/i;
  var MAX_PLAYERS = 25;
  var MAX_FILE = 5 * 1024 * 1024;
  var pendingToken = '';
  var invalidFragment = false;
  if (typeof window.FUFY_INITIAL_ACCESS === 'string') {
    pendingToken = window.FUFY_INITIAL_ACCESS.trim();
    invalidFragment = !TOKEN_RE.test(pendingToken);
    if (invalidFragment) pendingToken = '';
    delete window.FUFY_INITIAL_ACCESS;
  }

  // Remove invitation credentials before any API call or external navigation.
  try {
    var fragment = new URLSearchParams(window.location.hash.slice(1));
    if (fragment.has('acceso')) {
      pendingToken = (fragment.get('acceso') || '').trim();
      invalidFragment = !TOKEN_RE.test(pendingToken);
      if (invalidFragment) pendingToken = '';
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  } catch (ignore) {
    pendingToken = '';
  }

  var F = window.FufyPortal;
  var $ = function (id) { return document.getElementById(id); };
  var state = {
    token: '', snapshot: null, busy: false, clubDirty: false,
    playerDirty: false, editingId: null, editUpdatedAt: null
  };
  var delegationFields = [
    'club_city', 'club_country', 'delegate_name', 'delegate_email', 'delegate_phone', 'manager_name',
    'manager_phone', 'captain_name', 'first_aid_name', 'first_aid_phone', 'club_notes'
  ];
  var delegationFlags = ['accepted_bases', 'confirmed_accuracy', 'privacy_consent'];
  var playerFields = [
    'full_name', 'document_type', 'document_number', 'birth_date', 'nationality',
    'jersey_number', 'emergency_contact', 'emergency_phone', 'federation_status',
    'coverage_type', 'insurance_provider', 'insurance_valid_until', 'notes'
  ];
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

  if (!F) {
    setMessage('No se pudo cargar el acceso a las nóminas. Recarga esta página. Los enlaces informativos de Chile Rugby siguen disponibles abajo.', 'error');
    $('fp-access-form').querySelector('button').disabled = true;
    return;
  }

  var esc = F.esc;
  var dialog = $('fp-player-dialog');

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
    return !state.busy;
  }

  function updateDirty() {
    $('fp-unsaved').textContent = state.clubDirty
      ? 'Tienes cambios sin guardar.'
      : 'Sin cambios pendientes.';
    $('fp-unsaved').className = state.clubDirty ? 'fp-small fp-age-alert' : 'fp-small fp-muted';
  }

  function syncDocumentTarget() {
    var wholeClub = ['signed_roster', 'manager_declaration'].includes($('fp-document-kind').value);
    var selector = $('fp-document-player');
    if (wholeClub) selector.value = '';
    selector.disabled = wholeClub || state.busy || isReadOnly();
  }

  function syncActions() {
    var locked = state.busy || isReadOnly();
    document.querySelectorAll('[data-fp-write]').forEach(function (button) {
      button.disabled = locked;
    });
    document.querySelectorAll('.fp-mutable').forEach(function (fieldset) {
      fieldset.disabled = locked;
    });
    $('fp-add-player').disabled = locked || players().length >= MAX_PLAYERS;
    $('fp-add-player').textContent = players().length >= MAX_PLAYERS
      ? 'Plantel completo · 25/25'
      : '+ Agregar jugador';
    $('fp-csv').disabled = state.busy || !players().length;
    $('fp-print-roster').disabled = state.busy || !players().length;
    var status = state.snapshot && state.snapshot.submission && state.snapshot.submission.status;
    $('fp-submit').textContent = status === 'submitted' || status === 'observed'
      ? 'Volver a enviar a revisión'
      : 'Enviar nómina a revisión';
    $('fp-read-only').hidden = !isReadOnly();
    $('fp-read-only').textContent = isReadOnly() ? closeReason() : '';
    syncDocumentTarget();
    updateDirty();
  }

  async function runOperation(fn, options) {
    if (state.busy) return null;
    options = options || {};
    state.busy = true;
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
    var list = $('fp-player-list');
    if (!players().length) {
      list.innerHTML = '<div class="fp-empty"><strong>Tu nómina comienza aquí</strong><p>Agrega al primer jugador. Cada ficha puede guardarse con antecedentes pendientes.</p></div>';
      return;
    }
    list.innerHTML = '<div class="fp-player-cards">' + players().map(function (player, index) {
      var birthdayAge = ageYear(player.birth_date);
      var documentText = player.document_number
        ? (player.document_type || 'Documento') + ' ' + player.document_number
        : 'Documento por informar';
      var jerseyText = player.jersey_number != null ? ' · Camiseta ' + player.jersey_number : '';
      var review = player.review_note
        ? '<div class="fp-player-review"><strong>Organización:</strong> ' + esc(player.review_note) + '</div>'
        : '';
      var disabled = isReadOnly() ? ' disabled' : '';
      return '<article class="fp-player-card">' +
        '<div><h3><span class="fp-player-number">' + (index + 1) + '.</span> ' + esc(player.full_name || 'Sin nombre') + '</h3>' +
        '<p class="fp-player-id">' + esc(documentText + jerseyText) + '</p></div>' +
        '<div class="fp-player-actions">' + statusBadge(player.review_status || 'pending') +
        '<button type="button" class="fp-btn fp-btn--secondary fp-btn--small" data-action="edit-player" data-player-id="' + esc(player.id) + '">' +
        (isReadOnly() ? 'Ver ficha' : 'Editar') + '</button>' +
        '<button type="button" class="fp-btn fp-btn--quiet fp-btn--small" data-fp-write data-action="player-document" data-player-id="' + esc(player.id) + '"' + disabled + '>Adjuntar</button>' +
        '<button type="button" class="fp-btn fp-btn--danger fp-btn--small" data-fp-write data-action="delete-player" data-player-id="' + esc(player.id) + '"' + disabled + '>Quitar</button></div>' +
        '<div class="fp-player-meta">' +
        '<div class="fp-meta-item"><small>Edad</small><span class="' + (birthdayAge !== null && birthdayAge < 40 ? 'fp-age-alert' : '') + '">' + esc(ageText(player.birth_date)) + '</span></div>' +
        '<div class="fp-meta-item"><small>Registro federativo</small>' + esc(federationLabels[player.federation_status] || federationLabels.pending) + '</div>' +
        '<div class="fp-meta-item"><small>Atención médica</small>' + esc(coverageLabels[player.coverage_type] || coverageLabels.pending) +
        (player.insurance_provider ? ' · ' + esc(player.insurance_provider) : '') + '</div>' +
        '<div class="fp-meta-item"><small>Firma declarada</small>' + (player.signature_declared ? 'Sí · requiere documento' : 'Pendiente') + '</div>' +
        '</div>' + review + '</article>';
    }).join('') + '</div>';
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
    value = value.trim();
    if (TOKEN_RE.test(value)) return value.toLowerCase();
    try {
      var url = new URL(value, window.location.origin);
      var candidate = new URLSearchParams(url.hash.slice(1)).get('acceso') || '';
      return TOKEN_RE.test(candidate) ? candidate.toLowerCase() : '';
    } catch (ignore) {
      return '';
    }
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
    state.editingId = null;
    state.editUpdatedAt = null;
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

  function updatePlayerAge() {
    var value = $('fp-player-birth').value;
    var age = ageYear(value);
    $('fp-player-age').textContent = value ? ageText(value) + (age !== null && age < 40 ? ' · Revisión de categoría por la organización.' : '') : '';
    $('fp-player-age').className = age !== null && age < 40 ? 'fp-age-alert' : '';
  }

  function openPlayer(playerId) {
    if (!state.snapshot || state.busy) return;
    var player = playerId ? players().find(function (p) { return p.id === playerId; }) : null;
    if (playerId && !player) return;
    if (!player && (!canWrite() || players().length >= MAX_PLAYERS)) return;
    var form = $('fp-player-form');
    form.reset();
    state.editingId = player ? player.id : null;
    state.editUpdatedAt = player ? player.updated_at : null;
    getField(form, 'id').value = player ? player.id : '';
    playerFields.forEach(function (name) {
      var field = getField(form, name);
      if (player) field.value = player[name] == null ? '' : String(player[name]);
    });
    if (!player) {
      getField(form, 'nationality').value = state.snapshot.team.country || '';
      var country = String(state.snapshot.team.country || '').toLowerCase();
      getField(form, 'document_type').value = country === 'chile' || country === 'cl' ? 'RUT' : 'DNI';
      getField(form, 'federation_status').value = 'pending';
      getField(form, 'coverage_type').value = 'pending';
    }
    getField(form, 'signature_declared').checked = Boolean(player && player.signature_declared);
    state.playerDirty = false;
    $('fp-player-error').hidden = true;
    $('fp-player-error').textContent = '';
    $('fp-player-dialog-title').textContent = isReadOnly() ? 'Ficha de jugador' : (player ? 'Editar jugador' : 'Agregar jugador');
    syncActions();
    updatePlayerAge();
    dialog.showModal();
    if (isReadOnly()) $('fp-player-close').focus();
    else $('fp-player-name').focus();
  }

  function closePlayer() {
    if (state.busy) return;
    if (state.playerDirty && !window.confirm('¿Cerrar la ficha sin guardar los cambios de este jugador?')) return;
    state.playerDirty = false;
    state.editingId = null;
    state.editUpdatedAt = null;
    dialog.close();
    $('fp-player-form').reset();
  }

  function collectPlayer() {
    var form = $('fp-player-form');
    var data = {};
    playerFields.forEach(function (name) {
      data[name] = getField(form, name).value.trim();
    });
    if (state.editingId) data.id = state.editingId;
    data.jersey_number = data.jersey_number === '' ? null : Number(data.jersey_number);
    data.birth_date = data.birth_date || null;
    data.insurance_valid_until = data.insurance_valid_until || null;
    data.signature_declared = getField(form, 'signature_declared').checked;
    return data;
  }

  async function removePlayer(id, button) {
    if (!canWrite()) return;
    var player = players().find(function (p) { return p.id === id; });
    if (!player || !window.confirm('¿Quitar a ' + player.full_name + ' de esta nómina? Si ya reuniste firmas, revisa qué documentos deben actualizarse.')) return;
    await runOperation(async function () {
      applySnapshot(await call('delete_player', { player_id: id }));
    }, { button: button, success: 'Jugador retirado de la nómina. Revisa la lista de documentos pendientes.' });
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
    if (state.busy || !state.snapshot) return;
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

  function exportCSV() {
    if (!state.snapshot || !players().length) return;
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
    if (!state.snapshot || !players().length) return;
    if (state.clubDirty) {
      setMessage('Guarda los cambios de la delegación antes de imprimir para que la nómina y sus responsables coincidan.', 'warning');
      $('fp-delegation-form').querySelector('button[type=submit]').focus();
      return;
    }
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
      setMessage('Pega el enlace completo de invitación o el código de acceso recibido por tu club.', 'error');
      $('fp-access-code').focus();
      return;
    }
    enterClub(token, event.submitter);
  });

  $('fp-logout').addEventListener('click', function () {
    if (state.busy) return;
    if ((state.clubDirty || state.playerDirty) && !window.confirm('Tienes cambios sin guardar. ¿Cerrar el acceso y descartarlos?')) return;
    resetAccess();
  });

  $('fp-reload').addEventListener('click', async function (event) {
    if (state.clubDirty && !window.confirm('Al actualizar se reemplazarán los cambios de la delegación que no hayas guardado. ¿Continuar?')) return;
    await runOperation(async function () {
      var snapshot = await call('open');
      state.clubDirty = false;
      applySnapshot(snapshot, { forceDelegation: true });
    }, { button: event.currentTarget, success: 'Nómina actualizada.' });
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

  $('fp-add-player').addEventListener('click', function () { openPlayer(null); });
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
  $('fp-player-birth').addEventListener('input', updatePlayerAge);
  $('fp-player-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    if (!canWrite() || !$('fp-player-form').reportValidity()) return;
    var payload = { player: collectPlayer() };
    if (state.editingId && state.editUpdatedAt) payload.expected_updated_at = state.editUpdatedAt;
    await runOperation(async function () {
      var snapshot = await call('save_player', payload);
      state.playerDirty = false;
      state.editingId = null;
      state.editUpdatedAt = null;
      dialog.close();
      $('fp-player-form').reset();
      applySnapshot(snapshot);
    }, {
      button: event.submitter, working: 'Guardando…',
      success: 'Jugador guardado. Revisa los antecedentes pendientes y las firmas que deban actualizarse.',
      errorTarget: $('fp-player-error')
    });
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
    }, { button: event.currentTarget, working: 'Enviando…', success: 'Nómina enviada a revisión. Los antecedentes que falten permanecen visibles en tu lista de pendientes.' });
  });

  $('fp-workspace').addEventListener('click', function (event) {
    var button = event.target.closest('button[data-action]');
    if (!button || button.disabled || state.busy) return;
    var action = button.dataset.action;
    var id = button.dataset.playerId;
    if (action === 'edit-player') openPlayer(id);
    if (action === 'delete-player') removePlayer(id, button);
    if (action === 'player-document') preparePlayerDocument(id);
    if (action === 'open-document') openDocument(button.dataset.documentId, button);
    if (action === 'delete-document') removeDocument(button.dataset.documentId, button);
  });
  $('fp-csv').addEventListener('click', exportCSV);
  $('fp-print-roster').addEventListener('click', printRoster);
  window.addEventListener('afterprint', function () { $('fp-print').textContent = ''; });
  window.addEventListener('beforeunload', function (event) {
    if (state.clubDirty || state.playerDirty) {
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
  if (TOKEN_RE.test(pendingToken)) enterClub(pendingToken.toLowerCase(), null);
  else if (invalidFragment) setMessage('El enlace de invitación está incompleto. Pega el enlace completo recibido por tu club o solicita uno nuevo a la organización.', 'error');
})();
