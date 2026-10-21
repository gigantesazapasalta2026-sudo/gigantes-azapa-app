(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const P = window.FufyPortal;
  if (!P || !window.supabase) {
    $('message').textContent = 'No se pudo cargar el portal. Revisa tu conexión y vuelve a abrir esta página.';
    $('message').className = 'notice error';
    return;
  }
  const client = window.supabase.createClient(window.GIGANTES_SUPABASE_URL, window.GIGANTES_SUPABASE_PUBLISHABLE_KEY, {
    auth: { storage: window.GIGANTES_AUTH_STORAGE, persistSession: true, autoRefreshToken: true }
  });
  const esc = P.esc;
  const statusNames = { draft: 'Borrador', submitted: 'Enviado para revisión', observed: 'Con observaciones', approved: 'Expediente revisado', pending: 'Pendiente', reviewed: 'Antecedentes revisados' };
  const federationNames = { pending: 'Pendiente', declared: 'Inscripción declarada', not_applicable: 'No aplica / por revisar' };
  const coverageNames = { pending: 'Pendiente', insurance: 'Seguro', prevision: 'Previsión', other: 'Otros medios de atención' };
  const documentNames = { signed_roster: 'Nómina y declaraciones firmadas', manager_declaration: 'Declaración del mánager', player_declaration: 'Declaración del jugador', insurance: 'Cobertura / seguro', federation: 'Chile Rugby', identity: 'Identificación', other: 'Otro respaldo' };
  let teams = [], snapshots = new Map(), current = null, currentPlayer = null;
  let loadSerial = 0, viewSerial = 0, confirmAction = null, busyReview = false;

  const label = value => statusNames[value] || P.statusLabel(value) || 'Pendiente';
  const date = value => value ? P.formatDate(value) : 'Sin registro';
  const dateTime = value => {
    const parsed = value ? new Date(value) : null;
    return parsed && !Number.isNaN(parsed.getTime()) ? new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Santiago' }).format(parsed) : 'Sin registro';
  };
  const yes = value => value === true ? 'Sí, declarado' : 'Pendiente';
  const checks = snapshot => ({ missing: Array.isArray(snapshot?.checks?.missing) ? snapshot.checks.missing : [], warnings: Array.isArray(snapshot?.checks?.warnings) ? snapshot.checks.warnings : [] });
  const itemText = item => typeof item === 'string' ? item : String(item?.message || item?.label || item?.title || 'Antecedente por revisar');
  const yearAge = birth => /^\d{4}-\d{2}-\d{2}$/.test(String(birth || '')) ? 2026 - Number(birth.slice(0, 4)) : null;
  const badge = value => '<span class="badge ' + ({ approved: 'green', reviewed: 'green', observed: 'amber', submitted: 'blue' }[value] || '') + '">' + esc(label(value)) + '</span>';
  function message(text, kind = '') { $('message').textContent = text; $('message').className = 'notice' + (kind ? ' ' + kind : ''); }
  function pairs(rows) { return rows.map(([key, value]) => '<dt>' + esc(key) + '</dt><dd>' + esc(value ?? '—') + '</dd>').join(''); }
  function list(items, empty) { return items.length ? '<ul class="check-list">' + items.map(x => '<li>' + esc(itemText(x)) + '</li>').join('') + '</ul>' : '<p class="small compact">' + esc(empty) + '</p>'; }

  async function authToken() {
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData?.user) {
      const error = new Error('Tu sesión no está disponible. Vuelve a iniciar sesión.'); error.status = 401; throw error;
    }
    const { data, error } = await client.auth.getSession();
    if (error || !data?.session?.access_token) {
      const failure = new Error('Tu sesión venció. Vuelve a iniciar sesión.'); failure.status = 401; throw failure;
    }
    return data.session.access_token;
  }
  async function api(action, payload = {}) { return P.request(action, payload, { jwt: await authToken() }); }
  function handleError(error) {
    message(error?.status === 409 ? 'El club o la organización actualizó este expediente mientras lo revisabas. Actualiza el expediente y comprueba la versión vigente antes de guardar; esta operación no se aplicó.' : error?.message || 'No se pudo completar la operación. Inténtalo de nuevo.', 'error');
    if (error?.status === 401 || error?.status === 403) {
      $('app').hidden = true; $('authHelp').hidden = false;
      document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
      if (error.status === 403) $('authHelp').querySelector('p').textContent = 'Esta cuenta no tiene permisos para administrar los clubes invitados. Ingresa con una cuenta de organización autorizada.';
    }
  }

  async function loadTeams({ quiet = false } = {}) {
    const serial = ++loadSerial;
    $('refresh').disabled = true;
    if (!quiet) message('Cargando accesos, nóminas y antecedentes pendientes…');
    try {
      const result = await api('admin_list');
      if (serial !== loadSerial) return;
      if (result.can_manage !== true) { const denied = new Error('Esta cuenta no tiene permisos para administrar los clubes invitados.'); denied.status = 403; throw denied; }
      teams = Array.isArray(result.teams) ? result.teams : [];
      $('app').hidden = false; $('authHelp').hidden = true; $('logout').hidden = false;
      renderTeams();
      const jwt = await authToken();
      const results = await Promise.allSettled(teams.map(team => P.request('admin_open', { team_id: team.id }, { jwt })));
      if (serial !== loadSerial) return;
      let failed = 0;
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') snapshots.set(teams[index].id, result.value);
        else { snapshots.delete(teams[index].id); failed++; }
      });
      renderTeams();
      if (!quiet || failed) message(failed ? 'Se cargaron los clubes, pero faltó consultar ' + failed + ' expediente(s). Usa Actualizar o abre el club para reintentar.' : 'Accesos y expedientes actualizados. Los datos permanecen privados.', failed ? 'warning' : 'success');
    } catch (error) { handleError(error); }
    finally { if (serial === loadSerial) $('refresh').disabled = false; }
  }
  function renderTeams() {
    let total = 0, review = 0, incomplete = 0, unread = 0;
    $('teamsBody').innerHTML = teams.map(team => {
      const snapshot = snapshots.get(team.id), submission = snapshot?.submission || team.submission;
      const playerCount = snapshot ? (snapshot.players || []).length : Number(team.player_count || 0);
      const docs = snapshot?.documents || [], counts = checks(snapshot);
      total += playerCount;
      if (['submitted', 'observed'].includes(submission?.status)) review++;
      if (snapshot && counts.missing.length) incomplete++;
      if (!snapshot) unread++;
      const invitation = team.invitation;
      const active = !!invitation?.active && (!invitation.expires_at || new Date(invitation.expires_at).getTime() > Date.now());
      const inviteText = active ? 'Enlace activo' : invitation ? 'Sin enlace vigente' : 'Sin acceso creado';
      const currentDocs = docs.filter(d => d.is_current !== false).length;
      const closed = snapshot?.access?.read_only === true;
      const location = [submission?.club_city || snapshot?.team?.city || team.city, submission?.club_country || snapshot?.team?.country || team.country].filter(Boolean).join(' · ');
      return '<tr><td><strong>' + esc(team.name) + '</strong><small>' + esc(location) + '</small></td>' +
        '<td>' + badge(submission?.status || 'draft') + (closed ? '<small>Edición cerrada</small>' : '') + (submission?.submitted_at ? '<small>Enviado: ' + esc(date(submission.submitted_at)) + '</small>' : '') + '</td>' +
        '<td><strong>' + playerCount + ' / 25 jugadores</strong><small>' + (snapshot ? currentDocs + ' archivos actuales' : Number(team.document_count || 0) + ' archivos') + '</small></td>' +
        '<td>' + (snapshot ? '<strong>' + counts.missing.length + ' pendientes</strong><small>' + counts.warnings.length + ' alertas de revisión</small>' : '<span class="small">Consultar expediente</span>') + '</td>' +
        '<td><span class="badge ' + (active ? 'green' : '') + '">' + inviteText + '</span>' + (invitation?.expires_at ? '<small>Vence: ' + esc(dateTime(invitation.expires_at)) + '</small>' : '') + '</td>' +
        '<td><div class="row-actions"><button class="btn small-btn" data-action="open" data-team="' + esc(team.id) + '">Abrir expediente</button>' +
        '<button class="btn secondary small-btn" data-action="invite" data-team="' + esc(team.id) + '">' + (active ? 'Renovar enlace' : 'Crear enlace') + '</button>' +
        (active ? '<button class="btn danger small-btn" data-action="revoke" data-team="' + esc(team.id) + '">Revocar</button>' : '') + '</div></td></tr>';
    }).join('') || '<tr><td colspan="6">No hay clubes participantes disponibles.</td></tr>';
    $('totalTeams').textContent = teams.length;
    $('totalPlayers').textContent = total;
    $('pendingReviews').textContent = review;
    $('incompleteTeams').textContent = unread ? incomplete + ' · ' + unread + ' por consultar' : incomplete;
  }

  async function openTeam(teamId, { focus = true } = {}) {
    const serial = ++viewSerial;
    $('refreshDossier').disabled = true;
    try {
      message('Consultando el expediente del club…');
      const snapshot = await api('admin_open', { team_id: teamId });
      if (serial !== viewSerial) return;
      acceptSnapshot(snapshot);
      $('dossier').hidden = false;
      if (focus) { $('dossier').scrollIntoView({ behavior: 'smooth', block: 'start' }); $('dossierTitle').focus({ preventScroll: true }); }
      message('Expediente cargado. Revisa sus datos, documentos y observaciones.', 'success');
    } catch (error) { if (serial === viewSerial) handleError(error); }
    finally { if (serial === viewSerial) $('refreshDossier').disabled = false; }
  }
  function acceptSnapshot(snapshot) {
    if (!snapshot?.team?.id) throw new Error('El servidor no entregó un expediente válido. Actualiza la página.');
    current = snapshot; snapshots.set(snapshot.team.id, snapshot);
    renderTeams(); renderDossier();
  }
  function renderDossier(preserveReviewNote = false) {
    if (!current) return;
    const { team, players = [], documents = [], access = {} } = current;
    const s = current.submission || {};
    const pending = checks(current);
    $('dossierTitle').textContent = team.name;
    $('dossierMeta').textContent = [s.club_city || team.city, s.club_country || team.country, label(s.status || 'draft'), 'Última actualización: ' + dateTime(s.updated_at)].filter(Boolean).join(' · ');
    $('accessNotice').textContent = access.read_only ? 'Edición del club cerrada. ' + (access.reason || 'La organización debe autorizar cualquier corrección.') : 'El delegado puede actualizar la nómina. ' + (access.reason || 'El cierre se aplica al inicio de su primer partido o cuando lo indique la organización.');
    $('accessNotice').className = 'notice no-print' + (access.read_only ? ' warning' : '');
    $('lockRoster').disabled = access.read_only === true;
    $('unlockRoster').disabled = access.read_only !== true;
    $('contacts').innerHTML = pairs([
      ['Ciudad de la delegación', s.club_city || team.city || 'Pendiente'], ['País de la delegación', s.club_country || team.country || 'Pendiente'],
      ['Delegado', s.delegate_name || 'Pendiente'], ['Correo delegado', s.delegate_email || 'Pendiente'], ['Teléfono delegado', s.delegate_phone || 'Pendiente'],
      ['Mánager', s.manager_name || 'Pendiente'], ['Teléfono mánager', s.manager_phone || 'Pendiente'], ['Capitán', s.captain_name || 'Pendiente'],
      ['Apoyo primeros auxilios', s.first_aid_name || 'Pendiente'], ['Teléfono de apoyo', s.first_aid_phone || 'Pendiente']
    ]);
    $('declarations').innerHTML = pairs([
      ['Bases conocidas', yes(s.accepted_bases)], ['Veracidad de datos', yes(s.confirmed_accuracy)], ['Tratamiento de datos', yes(s.privacy_consent)],
      ['Envío del club', date(s.submitted_at)], ['Revisión de organización', date(s.reviewed_at)]
    ]);
    $('missingChecks').innerHTML = list(pending.missing, 'Sin faltantes documentales detectados. Revisar los respaldos antes de cerrar el expediente.');
    $('warningChecks').innerHTML = list(pending.warnings, 'Sin alertas automáticas adicionales. La revisión final corresponde a la organización.');
    $('missingBox').classList.toggle('revisit', pending.missing.length > 0);
    $('warningsBox').classList.toggle('revisit', pending.warnings.length > 0);
    $('clubNotesBox').hidden = !s.club_notes; $('clubNotes').textContent = s.club_notes || '';
    $('playerCount').textContent = players.length + ' / 25 jugadores';
    $('playersBody').innerHTML = players.map(player => {
      const age = P.ageOnEvent(player.birth_date), yearly = yearAge(player.birth_date);
      const marked = yearly !== null && yearly < 40;
      return '<tr><td><strong>' + esc(player.full_name) + '</strong><small>' + (player.jersey_number != null ? 'Camiseta ' + esc(player.jersey_number) + ' · ' : '') + esc(player.nationality || '') + '</small></td>' +
        '<td>' + esc(player.document_type || '') + '<small>' + esc(player.document_number || 'Pendiente') + '</small></td>' +
        '<td>' + esc(date(player.birth_date)) + '<small class="' + (marked ? 'underage' : '') + '">' + esc(age == null ? 'Edad por revisar' : age + ' al evento') + ' · ' + esc(yearly == null ? '—' : yearly + ' en 2026') + '</small>' + (marked ? '<small>Excepción: revisar criterio</small>' : '') + '</td>' +
        '<td>' + esc(federationNames[player.federation_status] || 'Pendiente') + '</td>' +
        '<td>' + esc(coverageNames[player.coverage_type] || 'Pendiente') + '<small>' + esc(player.insurance_provider || '') + '</small>' + (player.insurance_valid_until ? '<small>Vigencia declarada: ' + esc(date(player.insurance_valid_until)) + '</small>' : '') + '</td>' +
        '<td>' + esc(yes(player.signature_declared)) + '</td><td>' + badge(player.review_status || 'pending') + (player.review_note ? '<small class="preline">' + esc(player.review_note) + '</small>' : '') + '</td>' +
        '<td><button type="button" class="btn secondary small-btn" data-player="' + esc(player.id) + '">Revisar</button></td></tr>';
    }).join('') || '<tr><td colspan="8">El club aún no ha registrado jugadores.</td></tr>';
    $('documents').innerHTML = documents.map(doc => {
      const player = players.find(p => p.id === doc.player_id);
      const stale = doc.is_current === false;
      return '<article class="doc' + (stale ? ' revisit' : '') + '"><span class="badge' + (stale ? ' amber' : '') + '">' + esc(documentNames[doc.kind] || 'Respaldo') + '</span><strong>' + esc(doc.file_name) + '</strong>' +
        '<p>' + esc(player?.full_name || 'Documento del club') + ' · ' + esc(date(doc.created_at)) + ' · ' + Math.max(1, Math.round(Number(doc.size_bytes || 0) / 1024)) + ' KB</p>' +
        (stale ? '<p><strong>Reemplazar por versión actual.</strong> Este respaldo ya no corresponde a la nómina vigente.</p>' : '') +
        '<button type="button" class="btn secondary small-btn" data-document="' + esc(doc.id) + '">Abrir documento</button></article>';
    }).join('') || '<p class="empty">Todavía no hay documentos adjuntos.</p>';
    $('lastReview').textContent = s.review_note ? 'Última observación: ' + s.review_note : 'Todavía no hay una observación de organización registrada.';
    if (!preserveReviewNote) $('reviewNote').value = s.review_note || '';
    const canReview = ['submitted', 'observed'].includes(s.status);
    $('observeSubmission').disabled = busyReview || !canReview;
    $('approveSubmission').disabled = busyReview || !canReview || pending.missing.length > 0 || !players.length;
    $('reviewHelp').textContent = !canReview ? (s.status === 'approved' ? 'El expediente ya fue revisado. Si el club modifica antecedentes, será necesario revisar nuevamente su envío.' : 'El club debe enviar su nómina para iniciar la revisión.') : pending.missing.length ? 'Puedes enviar observaciones. Para marcar el expediente revisado, primero deben completarse los antecedentes pendientes.' : pending.warnings.length ? 'Hay alertas pendientes de criterio: indica en la observación cómo se resolvieron antes de marcar el expediente revisado.' : 'Agrega las observaciones que correspondan y registra la revisión de los documentos.';
  }

  function ask({ title, description, button = 'Confirmar', reason = false, action }) {
    confirmAction = action;
    $('confirmTitle').textContent = title; $('confirmDescription').textContent = description;
    $('acceptConfirm').textContent = button; $('acceptConfirm').disabled = false; $('cancelConfirm').disabled = false;
    $('reasonField').hidden = !reason; $('exceptionReason').value = ''; $('confirmFeedback').textContent = '';
    $('confirmDialog').showModal();
    if (reason) $('exceptionReason').focus();
  }
  function invite(team) {
    const replacing = !!team.invitation;
    ask({ title: (replacing ? 'Renovar acceso: ' : 'Crear acceso: ') + team.name,
      description: replacing ? 'Se generará un nuevo enlace privado y el anterior dejará de funcionar inmediatamente. La nómina y los documentos se conservarán. Deberás entregar el nuevo enlace al delegado.' : 'Se generará un enlace privado para que el delegado ingrese su nómina y documentos. El enlace se mostrará una sola vez para copiarlo.',
      button: replacing ? 'Renovar enlace' : 'Crear enlace',
      action: async () => {
        const result = await api('admin_invite', { team_id: team.id });
        const url = new URL(result.url);
        const token = new URLSearchParams(url.hash.slice(1)).get('acceso');
        if (url.protocol !== 'https:' || !['gigantesdeazapa.cl', 'www.gigantesdeazapa.cl', location.hostname].includes(url.hostname) || !/^[a-f0-9]{64}$/i.test(token || '')) throw new Error('El enlace recibido no es válido. Actualiza y vuelve a generarlo.');
        $('confirmDialog').close();
        $('inviteTitle').textContent = 'Acceso privado · ' + (result.team_name || team.name);
        $('inviteDescription').textContent = 'Vigente hasta ' + dateTime(result.expires_at) + ' (hora de Chile). Este enlace no se envió automáticamente.';
        $('inviteUrl').value = url.href; $('copyFeedback').textContent = '';
        $('inviteDialog').showModal();
        await loadTeams({ quiet: true });
        message('Acceso del club generado. Copia el enlace desde la ventana abierta.', 'success');
      }
    });
  }
  function revoke(team) {
    ask({ title: 'Revocar acceso de ' + team.name, description: 'Su enlace dejará de funcionar. Se conservarán todos los datos y documentos del club; podrás crear un nuevo acceso cuando sea necesario.', button: 'Revocar enlace', action: async () => {
      await api('admin_revoke', { team_id: team.id });
      $('confirmDialog').close(); await loadTeams({ quiet: true });
      message('Se revocó el enlace del club. Su expediente se conserva.', 'success');
    } });
  }
  function lock() {
    if (!current) return;
    const id = current.team.id;
    ask({ title: 'Cerrar nómina de ' + current.team.name, description: 'El delegado podrá consultar sus antecedentes, pero ya no podrá modificar jugadores ni documentos. Las correcciones posteriores requieren una excepción de la organización.', button: 'Cerrar edición', action: async () => {
      const snapshot = await api('admin_lock', { team_id: id });
      $('confirmDialog').close(); if (current?.team.id === id) acceptSnapshot(snapshot); else snapshots.set(id, snapshot);
      message('Edición de la nómina cerrada para el club.', 'success');
    } });
  }
  function unlock() {
    if (!current) return;
    const id = current.team.id;
    ask({ title: 'Autorizar correcciones de ' + current.team.name, description: 'El delegado podrá corregir la nómina durante 2 horas. Usa esta opción cuando el Comité haya autorizado la excepción; su motivo quedará registrado.', reason: true, button: 'Autorizar por 2 horas', action: async () => {
      const reason = $('exceptionReason').value.trim();
      if (reason.length < 10 || reason.length > 1200) throw new Error('Indica el motivo y la autorización de esta excepción usando entre 10 y 1.200 caracteres.');
      const snapshot = await api('admin_unlock', { team_id: id, reason });
      $('confirmDialog').close(); if (current?.team.id === id) acceptSnapshot(snapshot); else snapshots.set(id, snapshot);
      message('Correcciones autorizadas por 2 horas. El motivo quedó registrado.', 'success');
    } });
  }
  async function copyInvite() {
    const input = $('inviteUrl');
    if (!input.value) return;
    try { await navigator.clipboard.writeText(input.value); $('copyFeedback').textContent = 'Enlace copiado. Compártelo únicamente con el delegado del club.'; }
    catch { input.focus(); input.select(); $('copyFeedback').textContent = 'El navegador no permitió copiar automáticamente. El enlace está seleccionado: usa Copiar o Ctrl+C.'; }
  }

  async function openDocument(documentId, button) {
    if (!current) return;
    const teamId = current.team.id;
    const tab = window.open('', '_blank');
    if (tab) { tab.opener = null; tab.document.title = 'Abriendo documento privado'; tab.document.body.textContent = 'Preparando acceso temporal al documento…'; }
    button.disabled = true;
    try {
      const result = await api('admin_document', { team_id: teamId, document_id: documentId });
      const url = new URL(result.url), storageHost = new URL(window.GIGANTES_SUPABASE_URL).hostname;
      if (url.protocol !== 'https:' || url.hostname !== storageHost) throw new Error('No se recibió un enlace seguro al documento.');
      if (tab) tab.location.replace(url.href);
      else { message('Tu navegador bloqueó la ventana. Permite ventanas emergentes para abrir los documentos privados.', 'warning'); }
    } catch (error) { if (tab) tab.close(); handleError(error); }
    finally { button.disabled = false; }
  }
  function editPlayer(id) {
    if (!current) return;
    const player = (current.players || []).find(p => p.id === id);
    if (!player) return;
    currentPlayer = { teamId: current.team.id, id, updatedAt: player.updated_at };
    $('playerTitle').textContent = player.full_name;
    $('playerSubtitle').textContent = current.team.name + ' · ' + (player.document_type || '') + ' ' + (player.document_number || '');
    $('playerDetails').innerHTML = '<dl class="kv">' + pairs([
      ['Contacto de emergencia', player.emergency_contact || 'Pendiente'], ['Teléfono emergencia', player.emergency_phone || 'Pendiente'],
      ['Cobertura declarada', coverageNames[player.coverage_type] || 'Pendiente'], ['Prestador', player.insurance_provider || 'Sin especificar'],
      ['Observaciones del club', player.notes || 'Sin observaciones']
    ]) + '</dl>';
    $('playerReviewStatus').value = ['pending', 'observed', 'reviewed'].includes(player.review_status) ? player.review_status : 'pending';
    $('playerReviewNote').value = player.review_note || ''; $('playerFeedback').textContent = '';
    $('savePlayerReview').disabled = false; $('playerDialog').showModal();
  }
  async function savePlayerReview(event) {
    event.preventDefault(); if (!currentPlayer) return;
    const { teamId, id, updatedAt } = currentPlayer;
    const reviewStatus = $('playerReviewStatus').value, note = $('playerReviewNote').value.trim();
    if (note.length > 1500 || (reviewStatus === 'observed' && note.length < 5)) { $('playerFeedback').textContent = 'Describe qué antecedente debe corregirse usando entre 5 y 1.500 caracteres para una observación.'; $('playerReviewNote').focus(); return; }
    $('savePlayerReview').disabled = true;
    try {
      const snapshot = await api('admin_review_player', { team_id: teamId, player_id: id, review_status: reviewStatus, review_note: note, expected_updated_at: updatedAt });
      $('playerDialog').close();
      if (current?.team.id === teamId) acceptSnapshot(snapshot); else snapshots.set(teamId, snapshot);
      message('Revisión del jugador guardada.', 'success');
    } catch (error) { $('playerFeedback').textContent = error.status === 409 ? 'Los antecedentes cambiaron. Esta revisión no se guardó. Cierra esta ventana, actualiza el expediente y revisa la versión vigente.' : error.message || 'No se pudo guardar la revisión.'; }
    finally { $('savePlayerReview').disabled = false; }
  }
  async function reviewSubmission(status) {
    if (!current || busyReview) return;
    const teamId = current.team.id, note = $('reviewNote').value.trim(), updatedAt = current.submission?.updated_at;
    if (note.length > 2500 || (note.length < 5 && (status === 'observed' || checks(current).warnings.length > 0))) {
      message('Escribe la observación o el criterio con que resolviste las alertas usando entre 5 y 2.500 caracteres antes de guardar.', 'warning'); $('reviewNote').focus(); return;
    }
    busyReview = true; $('observeSubmission').disabled = true; $('approveSubmission').disabled = true;
    try {
      const snapshot = await api('admin_review', { team_id: teamId, status, review_note: note, expected_updated_at: updatedAt });
      if (current?.team.id === teamId) acceptSnapshot(snapshot); else snapshots.set(teamId, snapshot);
      message(status === 'approved' ? 'Expediente marcado como revisado por la organización. La habilitación deportiva, sanitaria y federativa se verifica por separado.' : 'Observaciones guardadas y disponibles para el delegado en su portal.', 'success');
    } catch (error) { handleError(error); }
    finally { busyReview = false; if (current) renderDossier(true); }
  }
  function exportRoster() {
    if (!current) return;
    const rows = [['Club', 'Nombre completo', 'Documento', 'Número documento', 'Fecha nacimiento', 'Edad al evento', 'Cumple en 2026', 'Nacionalidad', 'Camiseta', 'Contacto emergencia', 'Teléfono emergencia', 'Chile Rugby declarado', 'Cobertura declarada', 'Prestador', 'Vigencia declarada', 'Firma declarada', 'Revisión organización', 'Observación revisión', 'Observación club'],
      ...(current.players || []).map(p => [current.team.name, p.full_name, p.document_type, p.document_number, p.birth_date, P.ageOnEvent(p.birth_date), yearAge(p.birth_date), p.nationality, p.jersey_number, p.emergency_contact, p.emergency_phone, federationNames[p.federation_status] || 'Pendiente', coverageNames[p.coverage_type] || 'Pendiente', p.insurance_provider, p.insurance_valid_until, p.signature_declared ? 'Sí' : 'Pendiente', label(p.review_status || 'pending'), p.review_note, p.notes])];
    const safeName = String(current.team.name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 70);
    P.downloadCSV('Copa_FUFY_2026_Nomina_' + safeName + '.csv', rows);
  }

  $('teamsBody').addEventListener('click', event => {
    const button = event.target.closest('button[data-action]'); if (!button) return;
    const team = teams.find(t => t.id === button.dataset.team); if (!team) return;
    if (button.dataset.action === 'open') openTeam(team.id);
    if (button.dataset.action === 'invite') invite(team);
    if (button.dataset.action === 'revoke') revoke(team);
  });
  $('playersBody').addEventListener('click', event => { const button = event.target.closest('button[data-player]'); if (button) editPlayer(button.dataset.player); });
  $('documents').addEventListener('click', event => { const button = event.target.closest('button[data-document]'); if (button) openDocument(button.dataset.document, button); });
  $('refresh').addEventListener('click', () => loadTeams());
  $('refreshDossier').addEventListener('click', () => { if (current) openTeam(current.team.id, { focus: false }); });
  $('closeDossier').addEventListener('click', () => { viewSerial++; current = null; $('dossier').hidden = true; $('overview').scrollIntoView({ behavior: 'smooth' }); });
  $('exportRoster').addEventListener('click', exportRoster);
  $('printDossier').addEventListener('click', () => window.print());
  $('lockRoster').addEventListener('click', lock); $('unlockRoster').addEventListener('click', unlock);
  $('observeSubmission').addEventListener('click', () => reviewSubmission('observed'));
  $('approveSubmission').addEventListener('click', () => reviewSubmission('approved'));
  $('cancelConfirm').addEventListener('click', () => $('confirmDialog').close());
  $('confirmDialog').addEventListener('close', () => { confirmAction = null; $('exceptionReason').value = ''; });
  $('confirmDialog').addEventListener('cancel', event => { if ($('acceptConfirm').disabled) event.preventDefault(); });
  $('acceptConfirm').addEventListener('click', async () => {
    if (!confirmAction || $('acceptConfirm').disabled) return;
    const action = confirmAction; $('acceptConfirm').disabled = true; $('cancelConfirm').disabled = true; $('confirmFeedback').textContent = 'Guardando…';
    try { await action(); }
    catch (error) { $('confirmFeedback').textContent = error.message || 'No se pudo completar la operación.'; }
    finally { $('acceptConfirm').disabled = false; $('cancelConfirm').disabled = false; }
  });
  $('copyInvite').addEventListener('click', copyInvite); $('closeInvite').addEventListener('click', () => $('inviteDialog').close());
  $('inviteDialog').addEventListener('close', () => { $('inviteUrl').value = ''; $('copyFeedback').textContent = ''; });
  $('cancelPlayer').addEventListener('click', () => $('playerDialog').close());
  $('playerDialog').addEventListener('close', () => { currentPlayer = null; $('playerReviewNote').value = ''; });
  $('playerReviewForm').addEventListener('submit', savePlayerReview);
  $('logout').addEventListener('click', async () => {
    $('logout').disabled = true;
    try { await client.auth.signOut({ scope: 'local' }); }
    finally { current = null; snapshots.clear(); location.replace('login.html?next=fufy-clubes.html'); }
  });
  loadTeams();
})();
