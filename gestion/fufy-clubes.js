(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const P = window.FufyPortal;
  const Grid = window.FufyRosterGrid;
  if (!P || !Grid || !P.normalizeAccessKey) {
    $('message').textContent = 'No se pudo cargar el portal. Revisa tu conexión y vuelve a abrir esta página.';
    $('message').className = 'notice error';
    return;
  }
  const client = window.supabase?.createClient(window.GIGANTES_SUPABASE_URL, window.GIGANTES_SUPABASE_PUBLISHABLE_KEY, {
    auth: { storage: window.GIGANTES_AUTH_STORAGE, persistSession: true, autoRefreshToken: true }
  });
  const esc = P.esc;
  const statusNames = { draft: 'Borrador', submitted: 'Enviado para revisión', observed: 'Con observaciones', approved: 'Expediente revisado', pending: 'Pendiente', reviewed: 'Antecedentes revisados' };
  const federationNames = { pending: 'Pendiente', declared: 'Inscripción declarada', not_applicable: 'No aplica / por revisar' };
  const coverageNames = { pending: 'Pendiente', insurance: 'Seguro', prevision: 'Previsión', other: 'Otros medios de atención' };
  const documentNames = { signed_roster: 'Nómina y declaraciones firmadas', manager_declaration: 'Declaración del mánager', player_declaration: 'Declaración del jugador', insurance: 'Cobertura / seguro', federation: 'Chile Rugby', identity: 'Identificación', other: 'Otro respaldo' };
  const playerFields = ['full_name', 'document_type', 'document_number', 'birth_date', 'nationality', 'jersey_number', 'emergency_contact', 'emergency_phone', 'federation_status', 'coverage_type', 'insurance_provider', 'insurance_valid_until', 'signature_declared', 'notes'];
  let teams = [], snapshots = new Map(), current = null, currentPlayer = null;
  let loadSerial = 0, viewSerial = 0, confirmAction = null, busyReview = false;
  let rosterGrid = null, busyRoster = false, busyView = false, busyTeams = false, moreContext = null, pendingException = null, busyException = false;
  const ACCESS_STORAGE = 'fufy-admin-key-v1';
  let adminKey = '', busyAccess = false, authEpoch = 0;
  try { adminKey = P.normalizeAccessKey(sessionStorage.getItem(ACCESS_STORAGE) || '', 'admin'); }
  catch { /* The key can still be used in memory when browser storage is unavailable. */ }

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
    if (!client) { const error = new Error('No se pudo cargar el acceso con cuenta. Puedes entrar con tu clave de superadministrador.'); error.status = 401; throw error; }
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
  async function authContext() { return adminKey ? { adminKey } : { jwt: await authToken() }; }
  async function api(action, payload = {}) {
    const epoch = authEpoch;
    try {
      const access = await authContext();
      if (epoch !== authEpoch) throw cancelledOperation();
      const result = await P.request(action, payload, access);
      if (epoch !== authEpoch) throw cancelledOperation();
      return result;
    } catch (error) {
      if (epoch !== authEpoch) throw cancelledOperation();
      if (error?.status === 401 || error?.status === 403) handleError(error);
      throw error;
    }
  }
  function clearKey() {
    authEpoch++;
    adminKey = '';
    try { sessionStorage.removeItem(ACCESS_STORAGE); } catch { /* Memory was already cleared. */ }
    $('adminAccessKey').value = '';
  }
  function clearPrivateView() {
    loadSerial++; viewSerial++;
    current = null; currentPlayer = null; teams = []; snapshots.clear();
    busyTeams = false; busyView = false;
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    rosterGrid?.reset();
    for (const id of ['teamsBody', 'accessIdentity', 'dossierMeta', 'accessNotice', 'contacts', 'declarations', 'missingChecks', 'warningChecks', 'clubNotes', 'rosterHistory', 'documents', 'lastReview', 'reviewHelp', 'playerTitle', 'playerDetails', 'playerSubtitle', 'playerDataTitle', 'playerDataSubtitle', 'playerDataReview', 'exceptionSummary']) $(id).textContent = '';
    for (const id of ['reviewNote', 'playerReviewNote', 'inviteKey', 'inviteUrl']) $(id).value = '';
    for (const id of ['totalTeams', 'totalPlayers', 'pendingReviews', 'incompleteTeams', 'playerCount']) $(id).textContent = '—';
    $('dossierTitle').textContent = 'Nómina del club';
    $('app').hidden = true; $('dossier').hidden = true; $('authHelp').hidden = false; $('logout').hidden = true;
    syncAdminControls();
  }
  function handleError(error) {
    if (error?.accessHandled || error?.cancelled) return;
    message(error?.status === 409 ? 'El club o la organización actualizó este expediente mientras lo revisabas. Actualiza el expediente y comprueba la versión vigente antes de guardar; esta operación no se aplicó.' : error?.message || 'No se pudo completar la operación. Inténtalo de nuevo.', 'error');
    if (error?.status === 401 || error?.status === 403) {
      error.accessHandled = true;
      clearKey(); clearPrivateView();
      $('authDescription').textContent = 'Ingresa una clave vigente de superadministrador o utiliza tu cuenta autorizada de Control Center.';
    }
  }

  async function loadTeams({ quiet = false } = {}) {
    if (busyRoster || busyReview) return;
    const serial = ++loadSerial;
    busyTeams = true;
    $('refresh').disabled = true;
    if (!quiet) message('Cargando accesos, nóminas y antecedentes pendientes…');
    try {
      const result = await api('admin_list');
      if (serial !== loadSerial) return;
      if (result.can_manage !== true) { const denied = new Error('Esta cuenta no tiene permisos para administrar los clubes invitados.'); denied.status = 403; throw denied; }
      teams = Array.isArray(result.teams) ? result.teams : [];
      $('app').hidden = false; $('authHelp').hidden = true; $('logout').hidden = false;
      $('accessIdentity').textContent = result.admin_access?.label || (adminKey ? 'Superadministración · Copa FUFY' : 'Organización · Copa FUFY');
      if (adminKey) {
        try { sessionStorage.setItem(ACCESS_STORAGE, adminKey); } catch { /* The authenticated key stays in memory for this page. */ }
        $('adminAccessKey').value = '';
      }
      renderTeams();
      const access = await authContext();
      if (serial !== loadSerial) return;
      const results = await Promise.allSettled(teams.map(team => P.request('admin_open', { team_id: team.id }, access)));
      if (serial !== loadSerial) return;
      const denied = results.find(result => result.status === 'rejected' && [401, 403].includes(result.reason?.status));
      if (denied) throw denied.reason;
      let failed = 0;
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') snapshots.set(teams[index].id, result.value);
        else { snapshots.delete(teams[index].id); failed++; }
      });
      renderTeams();
      if (!quiet || failed) message(failed ? 'Se cargaron los clubes, pero faltó consultar ' + failed + ' expediente(s). Usa Actualizar o abre el club para reintentar.' : 'Accesos y expedientes actualizados. Los datos permanecen privados.', failed ? 'warning' : 'success');
    } catch (error) { handleError(error); }
    finally { if (serial === loadSerial) { busyTeams = false; syncAdminControls(); } }
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
      const inviteText = active ? (invitation.expires_at ? 'Acceso activo' : 'Acceso sin vencimiento') : invitation ? 'Acceso desactivado' : 'Sin acceso creado';
      const currentDocs = docs.filter(d => d.is_current !== false).length;
      const closed = snapshot?.access?.read_only === true;
      const location = [submission?.club_city || snapshot?.team?.city || team.city, submission?.club_country || snapshot?.team?.country || team.country].filter(Boolean).join(' · ');
      return '<tr><td><strong>' + esc(team.name) + '</strong><small>' + esc(location) + '</small></td>' +
        '<td>' + badge(submission?.status || 'draft') + (closed ? '<small>Edición cerrada</small>' : '') + (submission?.submitted_at ? '<small>Enviado: ' + esc(date(submission.submitted_at)) + '</small>' : '') + '</td>' +
        '<td><strong>' + playerCount + ' / 25 jugadores</strong><small>' + (snapshot ? currentDocs + ' archivos actuales' : Number(team.document_count || 0) + ' archivos') + '</small></td>' +
        '<td>' + (snapshot ? '<strong>' + counts.missing.length + ' pendientes</strong><small>' + counts.warnings.length + ' alertas de revisión</small>' : '<span class="small">Consultar expediente</span>') + '</td>' +
        '<td><span class="badge ' + (active ? 'green' : '') + '">' + inviteText + '</span>' + (invitation?.expires_at ? '<small>Vence: ' + esc(dateTime(invitation.expires_at)) + '</small>' : '') + '</td>' +
        '<td><div class="row-actions"><button class="btn small-btn" data-action="open" data-team="' + esc(team.id) + '">Abrir expediente</button>' +
        '<button class="btn secondary small-btn" data-action="invite" data-team="' + esc(team.id) + '">' + (active ? 'Renovar clave' : 'Crear clave') + '</button>' +
        (active ? '<button class="btn danger small-btn" data-action="revoke" data-team="' + esc(team.id) + '">Revocar</button>' : '') + '</div></td></tr>';
    }).join('') || '<tr><td colspan="6">No hay clubes participantes disponibles.</td></tr>';
    $('totalTeams').textContent = teams.length;
    $('totalPlayers').textContent = total;
    $('pendingReviews').textContent = review;
    $('incompleteTeams').textContent = unread ? incomplete + ' · ' + unread + ' por consultar' : incomplete;
    syncAdminControls();
  }

  async function openTeam(teamId, { focus = true } = {}) {
    if (busyRoster || busyReview || busyView) return;
    if (current?.team.id !== teamId && rosterGrid?.hasUnsavedChanges() && !window.confirm('Hay filas con cambios sin guardar. ¿Descartarlos y abrir otro club?')) return;
    const serial = ++viewSerial;
    busyView = true; rosterGrid?.setData({ disabled: true });
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
    finally { if (serial === viewSerial) { busyView = false; $('refreshDossier').disabled = false; rosterGrid?.setData({ disabled: busyReview }); syncAdminControls(); } }
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
    $('accessNotice').textContent = access.read_only ? 'Edición del delegado cerrada. ' + (access.reason || '') + ' Cada cambio de jugador desde Control Center requiere registrar la condición especial y el acuerdo de organización y de los cuatro clubes.' : 'El delegado y la organización pueden preparar la nómina. Todas las delegaciones se cierran al inicio del primer partido del campeonato o cuando lo indique la organización.';
    $('accessNotice').className = 'notice no-print' + (access.read_only ? ' warning' : '');
    $('contacts').innerHTML = pairs([
      ['Ciudad de la delegación', s.club_city || team.city || 'Pendiente'], ['País de la delegación', s.club_country || team.country || 'Pendiente'],
      ['Delegado', s.delegate_name || 'Pendiente'], ['Correo delegado', s.delegate_email || 'Pendiente'], ['Teléfono delegado', s.delegate_phone || 'Pendiente'],
      ['Mánager', s.manager_name || 'Pendiente'], ['Teléfono mánager', s.manager_phone || 'Pendiente'], ['Capitán', s.captain_name || 'Pendiente'],
      ['Apoyo ante situaciones de salud', s.first_aid_name || 'Pendiente'], ['Teléfono de apoyo', s.first_aid_phone || 'Pendiente']
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
    rosterGrid?.setData({ players, team, readOnly: false, disabled: busyReview || busyView });
    renderRosterHistory(current.roster_changes || []);
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
    syncAdminControls();
  }

  function syncAdminControls() {
    const blocked = busyRoster || busyReview || busyView;
    $('refresh').disabled = blocked || busyTeams;
    $('refreshDossier').disabled = blocked || !current;
    $('closeDossier').disabled = blocked;
    $('exportRoster').disabled = blocked || !current;
    $('printDossier').disabled = blocked || !current;
    $('addPlayer').disabled = blocked || !current || (current.players || []).length >= 25;
    $('lockRoster').disabled = blocked || !current || current.access?.read_only === true;
    $('lockAllRosters').disabled = blocked || busyTeams || teams.length !== 4 || teams.every(team => snapshots.get(team.id)?.access?.read_only === true);
    document.querySelectorAll('#teamsBody button').forEach(button => { button.disabled = blocked || busyTeams; });
    const canReview = !!current && ['submitted', 'observed'].includes(current.submission?.status);
    $('observeSubmission').disabled = blocked || !canReview;
    $('approveSubmission').disabled = blocked || !canReview || checks(current).missing.length > 0 || !(current?.players || []).length;
  }
  function renderRosterHistory(changes) {
    const labels = { added: 'Jugador agregado', updated: 'Jugador actualizado', removed: 'Jugador retirado', add: 'Jugador agregado', create: 'Jugador agregado', player_added: 'Jugador agregado', update: 'Jugador actualizado', player_updated: 'Jugador actualizado', remove: 'Jugador retirado', delete: 'Jugador retirado', player_removed: 'Jugador retirado' };
    $('rosterHistory').innerHTML = (Array.isArray(changes) ? changes : []).slice(0, 50).map(change => {
      const approvals = Array.isArray(change.club_approvals) ? change.club_approvals : [];
      const details = [['Tipo de registro', change.is_exception === true ? 'Excepción declarada por organización' : 'Movimiento antes del cierre']];
      if (change.reason) details.push(['Condición especial / motivo', change.reason]);
      if (change.organization_authorizer) details.push(['Autoriza por organización', change.organization_authorizer]);
      if (change.approval_reference) details.push(['Referencia del acuerdo', change.approval_reference]);
      return '<details class="change-entry"><summary>' + esc(labels[change.action] || 'Movimiento de nómina') + ' · ' + esc(change.player_name || 'Jugador') + ' · ' + esc(dateTime(change.created_at)) + '</summary><dl class="kv">' + pairs(details) + '</dl>' +
        (approvals.length ? '<p class="small" style="margin-top:12px">Representantes y autorizaciones declaradas:</p><ul>' + approvals.map(approval => '<li>' + esc(approval.team_name || teams.find(team => team.id === approval.team_id)?.name || 'Club registrado') + ': ' + esc(approval.representative_name || 'Sin nombre registrado') + ' · ' + esc(approval.approved === true ? 'autorización declarada' : 'sin autorización declarada') + '</li>').join('') + '</ul>' : '') + '</details>';
    }).join('') || '<p class="small">No hay movimientos administrativos registrados para este club.</p>';
  }
  function cancelledOperation() { const error = new Error('Cambio cancelado. La fila conserva sus datos sin guardar.'); error.cancelled = true; return error; }
  function mutationError(error) {
    if (error?.cancelled) return;
    handleError(error);
  }
  async function runRosterMutation(action, payload, playerName) {
    const teamId = payload.team_id;
    const context = { action, payload, playerName, teamName: current?.team.id === teamId ? current.team.name : teams.find(team => team.id === teamId)?.name || 'Club', isException: current?.team.id === teamId && (current.access?.read_only === true || current.access?.exception_required === true) };
    let snapshot;
    if (context.isException) snapshot = await requestException(context);
    else {
      try { snapshot = await api(action, payload); }
      catch (error) {
        if (error.status !== 423) throw error;
        const fresh = await api('admin_open', { team_id: teamId });
        if (current?.team.id === teamId) acceptSnapshot(fresh); else snapshots.set(teamId, fresh);
        if (fresh.access?.read_only !== true && fresh.access?.exception_required !== true) throw error;
        const playerId = payload.player_id || payload.player?.id;
        if (playerId && (fresh.players || []).find(player => player.id === playerId)?.updated_at !== payload.expected_updated_at) {
          const conflict = new Error('La ficha cambió antes de registrar la autorización. Actualiza y revisa los datos vigentes; tu borrador se conserva.'); conflict.status = 409; throw conflict;
        }
        context.isException = true;
        snapshot = await requestException(context);
      }
    }
    if (snapshot?.team?.id !== teamId) throw new Error('El servidor no devolvió el expediente esperado. Actualiza para comprobar el resultado.');
    const changed = action === 'admin_delete_player' ? 'Jugador retirado de la nómina.' : payload.player?.id ? 'Datos del jugador actualizados.' : 'Jugador agregado a la nómina.';
    message(changed + (context.isException ? ' La autorización específica quedó registrada y la edición del delegado sigue cerrada.' : '') + ' Comprueba las firmas y los respaldos pendientes del expediente.', 'success');
    return snapshot;
  }
  async function saveRosterPlayer(player, expectedUpdatedAt) {
    if (!current || busyReview || busyView) throw new Error('Espera a que termine la operación actual antes de guardar la fila.');
    const data = Object.fromEntries(playerFields.map(key => [key, player[key]]));
    if (player.id) data.id = player.id;
    const payload = { team_id: current.team.id, player: data };
    if (data.id) payload.expected_updated_at = expectedUpdatedAt;
    return runRosterMutation('admin_save_player', payload, data.full_name || 'Nuevo jugador');
  }
  async function removeRosterPlayer(player) {
    if (!current || busyReview || busyView) throw new Error('Espera a que termine la operación actual antes de retirar la fila.');
    return runRosterMutation('admin_delete_player', { team_id: current.team.id, player_id: player.id, expected_updated_at: player.updated_at }, player.full_name || 'Jugador');
  }
  function requestException(context) {
    if (pendingException) return Promise.reject(new Error('Termina o cancela la autorización abierta antes de registrar otro cambio.'));
    const clubs = teams.map(team => ({ id: team.id, name: team.name }));
    if (clubs.length !== 4 || new Set(clubs.map(team => team.id)).size !== 4 || !clubs.some(team => team.id === context.payload.team_id)) return Promise.reject(new Error('Actualiza la lista de los cuatro clubes antes de registrar una excepción. La fila conserva los datos pendientes.'));
    return new Promise((resolve, reject) => {
      pendingException = { ...context, clubs, resolve, reject };
      $('exceptionForm').reset(); $('exceptionFields').disabled = false; $('cancelException').disabled = false; $('saveException').disabled = false;
      const actionLabel = context.action === 'admin_delete_player' ? 'Retirar de la nómina' : context.payload.player?.id ? 'Modificar datos del jugador' : 'Agregar a la nómina';
      $('exceptionSummary').textContent = context.teamName + ' · ' + actionLabel + ': ' + context.playerName + '. Esta autorización se registra exclusivamente para esta operación.';
      $('saveException').textContent = context.action === 'admin_delete_player' ? 'Registrar autorización y retirar' : 'Registrar autorización y guardar';
      $('clubApprovals').innerHTML = clubs.map((club, index) => '<fieldset class="approval-club"><legend>' + esc(club.name) + '</legend><label class="field" for="representative' + index + '">Nombre del representante que autorizó<input id="representative' + index + '" minlength="3" maxlength="160" autocomplete="off" required></label><label class="check-field"><input id="representativeAgreed' + index + '" type="checkbox" required><span>Confirmo que este representante autorizó el cambio específico por ' + esc(club.name) + '.</span></label></fieldset>').join('');
      $('exceptionFeedback').textContent = '';
      $('exceptionDialog').showModal(); $('exceptionReason').focus();
    });
  }
  async function saveException(event) {
    event.preventDefault();
    if (!pendingException || busyException || !$('exceptionForm').reportValidity()) return;
    const pending = pendingException;
    const exception = {
      reason: $('exceptionReason').value.trim(), organization_authorizer: $('organizationAuthorizer').value.trim(), organization_agreed: $('organizationAgreed').checked,
      approval_reference: $('approvalReference').value.trim(), club_approvals: pending.clubs.map((club, index) => ({ team_id: club.id, representative_name: $('representative' + index).value.trim(), approved: $('representativeAgreed' + index).checked }))
    };
    if (exception.reason.length < 10 || exception.reason.length > 1200 || exception.organization_authorizer.length < 3 || exception.organization_authorizer.length > 160 || exception.approval_reference.length < 5 || exception.approval_reference.length > 1000 || !exception.organization_agreed || exception.club_approvals.some(approval => approval.representative_name.length < 3 || approval.representative_name.length > 160 || !approval.approved)) {
      $('exceptionFeedback').textContent = 'Completa el motivo, la referencia y los nombres reales de organización y de los cuatro representantes, y confirma cada autorización.'; return;
    }
    busyException = true; $('exceptionFields').disabled = true; $('cancelException').disabled = true; $('saveException').disabled = true; $('exceptionFeedback').textContent = 'Registrando la autorización y el cambio…';
    let conflict = false;
    try {
      const snapshot = await api(pending.action, { ...pending.payload, exception });
      pendingException = null; $('exceptionDialog').close(); pending.resolve(snapshot);
    } catch (error) {
      conflict = error.status === 409;
      $('exceptionFeedback').textContent = conflict ? 'La ficha cambió en otra sesión. Esta operación no se aplicó. Cancela, actualiza la nómina y revisa la versión vigente antes de registrar una nueva autorización.' : error.message || 'No se pudo registrar el cambio. Comprueba el expediente antes de repetir una operación incierta.';
      if (error.status === 401 || error.status === 403) handleError(error);
    } finally { busyException = false; $('exceptionFields').disabled = false; $('cancelException').disabled = false; $('saveException').disabled = conflict; }
  }
  function openPlayerData(player, context) {
    if (busyRoster || busyReview || busyView) return;
    moreContext = context;
    const form = $('playerDataForm'); form.reset();
    for (const key of ['emergency_contact', 'emergency_phone', 'notes']) form.elements.namedItem(key).value = player[key] || '';
    form.elements.namedItem('signature_declared').checked = player.signature_declared === true;
    $('playerDataTitle').textContent = player.full_name || 'Datos de la fila ' + context.rowNumber;
    $('playerDataSubtitle').textContent = (current?.team.name || '') + ' · Datos adicionales de inscripción';
    $('playerDataFields').disabled = context.readOnly === true; $('applyPlayerData').hidden = context.readOnly === true;
    $('playerDataReview').textContent = player.review_note ? 'Última observación de organización: ' + player.review_note : 'La revisión de antecedentes se registra por separado desde «Revisar».';
    $('playerDataDialog').showModal();
  }
  function applyPlayerData(event) {
    event.preventDefault();
    if (!moreContext || moreContext.readOnly || !$('playerDataForm').reportValidity()) return;
    const form = $('playerDataForm');
    moreContext.update({ emergency_contact: form.elements.namedItem('emergency_contact').value.trim(), emergency_phone: form.elements.namedItem('emergency_phone').value.trim(), notes: form.elements.namedItem('notes').value.trim(), signature_declared: form.elements.namedItem('signature_declared').checked });
    $('playerDataDialog').close();
  }
  function showPlayerDocuments(player) {
    $('documents').scrollIntoView({ behavior: 'smooth', block: 'start' });
    const ids = new Set((current?.documents || []).filter(document => !document.player_id || document.player_id === player.id).map(document => document.id));
    const first = Array.from($('documents').querySelectorAll('button[data-document]')).find(button => ids.has(button.dataset.document));
    if (first) first.focus({ preventScroll: true });
    else message('El jugador aún no tiene documentos propios ni un respaldo del club disponible. Los antecedentes pendientes siguen indicados en el expediente.', 'warning');
  }

  function ask({ title, description, button = 'Confirmar', action }) {
    confirmAction = action;
    $('confirmTitle').textContent = title; $('confirmDescription').textContent = description;
    $('acceptConfirm').textContent = button; $('acceptConfirm').disabled = false; $('cancelConfirm').disabled = false;
    $('confirmFeedback').textContent = '';
    $('confirmDialog').showModal();
  }
  function invite(team) {
    const replacing = !!team.invitation;
    ask({ title: (replacing ? 'Renovar acceso: ' : 'Crear acceso: ') + team.name,
      description: replacing ? 'Se generarán una clave y un enlace sin vencimiento. La clave y el enlace anteriores dejarán de funcionar inmediatamente. La nómina y los documentos se conservarán. Entrega los nuevos datos de acceso al delegado.' : 'Se generarán una clave y un enlace sin vencimiento para que el delegado ingrese su nómina y documentos. Podrás copiarlos en la siguiente ventana.',
      button: replacing ? 'Renovar clave y enlace' : 'Crear clave y enlace',
      action: async () => {
        const result = await api('admin_invite', { team_id: team.id });
        const url = new URL(result.url);
        const token = new URLSearchParams(url.hash.slice(1)).get('acceso');
        const key = P.normalizeAccessKey(result.access_key || '', 'club');
        if (url.protocol !== 'https:' || !['gigantesdeazapa.cl', 'www.gigantesdeazapa.cl', location.hostname].includes(url.hostname) || url.pathname !== '/fufy-clubes.html' || !P.normalizeAccessKey(token || '', 'club') || !key.startsWith('FUFY-')) throw new Error('Los datos de acceso recibidos no son válidos. Actualiza y vuelve a generarlos.');
        $('confirmDialog').close();
        $('inviteTitle').textContent = 'Acceso privado · ' + (result.team_name || team.name);
        $('inviteDescription').textContent = result.expires_at ? 'Vigente hasta ' + dateTime(result.expires_at) + ' (hora de Chile).' : 'Clave y enlace sin vencimiento.';
        $('inviteKey').value = key; $('inviteUrl').value = url.href; $('copyFeedback').textContent = '';
        $('inviteDialog').showModal();
        await loadTeams({ quiet: true });
        message('Acceso del club generado. Copia la clave y el enlace desde la ventana abierta.', 'success');
      }
    });
  }
  function revoke(team) {
    ask({ title: 'Revocar acceso de ' + team.name, description: 'Su clave y su enlace dejarán de funcionar. Se conservarán todos los datos y documentos del club; podrás crear un nuevo acceso cuando sea necesario.', button: 'Revocar acceso', action: async () => {
      await api('admin_revoke', { team_id: team.id });
      $('confirmDialog').close(); await loadTeams({ quiet: true });
      message('Se revocó el acceso del club. Su expediente se conserva.', 'success');
    } });
  }
  function lock() {
    if (!current || busyRoster || busyReview || busyView) return;
    const id = current.team.id;
    ask({ title: 'Cerrar nómina de ' + current.team.name, description: 'El delegado conservará la consulta de sus antecedentes y dejará de poder modificarlos. Este cierre no se reabre para el delegado. Cada cambio posterior de jugador deberá registrarse desde Control Center con una condición especial y las autorizaciones de organización y los cuatro clubes.', button: 'Cerrar edición del delegado', action: async () => {
      const snapshot = await api('admin_lock', { team_id: id });
      $('confirmDialog').close(); if (current?.team.id === id) acceptSnapshot(snapshot); else snapshots.set(id, snapshot);
      message('Edición de la nómina cerrada para el club.', 'success');
    } });
  }
  function lockAll() {
    if (busyRoster || busyReview || busyView || teams.length !== 4) return;
    ask({ title: 'Cerrar todas las nóminas', description: 'Se cerrará la edición de los delegados de los cuatro clubes. El cierre es definitivo para ellos: conservarán la consulta y no se podrá reabrir su edición. Cada cambio posterior de jugador se registrará únicamente desde Control Center, con condición especial y autorizaciones de organización y de los cuatro clubes.', button: 'Cerrar las cuatro nóminas', action: async () => {
      await api('admin_lock_all');
      $('confirmDialog').close(); await loadTeams({ quiet: true });
      const snapshot = current && snapshots.get(current.team.id);
      if (snapshot) acceptSnapshot(snapshot);
      message('Se cerró la edición de las cuatro delegaciones. Cada cambio posterior de jugador exige su autorización específica desde Control Center.', 'success');
    } });
  }
  async function copyInvite(inputId = 'inviteUrl') {
    const input = $(inputId), kind = inputId === 'inviteKey' ? 'Clave' : 'Enlace';
    if (!input.value) return;
    try { await navigator.clipboard.writeText(input.value); $('copyFeedback').textContent = kind + (inputId === 'inviteKey' ? ' copiada' : ' copiado') + ' para entregar al delegado del club.'; }
    catch { input.focus(); input.select(); $('copyFeedback').textContent = 'El navegador no permitió copiar automáticamente. El texto está seleccionado: usa Copiar o Ctrl+C.'; }
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
  function reviewPlayer(id) {
    if (!current || busyRoster || busyReview || busyView) return;
    if (rosterGrid?.hasUnsavedChanges()) { message('Guarda o descarta los cambios de la tabla antes de revisar los antecedentes del jugador.', 'warning'); return; }
    const player = (current.players || []).find(p => p.id === id);
    if (!player) return;
    currentPlayer = { teamId: current.team.id, id, updatedAt: player.updated_at };
    $('playerTitle').textContent = player.full_name;
    $('playerSubtitle').textContent = current.team.name + ' · Datos guardados · ' + (player.document_type || '') + ' ' + (player.document_number || '');
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
    event.preventDefault(); if (!currentPlayer || busyReview || busyRoster) return;
    const { teamId, id, updatedAt } = currentPlayer;
    const reviewStatus = $('playerReviewStatus').value, note = $('playerReviewNote').value.trim();
    if (note.length > 1500 || (reviewStatus === 'observed' && note.length < 5)) { $('playerFeedback').textContent = 'Describe qué antecedente debe corregirse usando entre 5 y 1.500 caracteres para una observación.'; $('playerReviewNote').focus(); return; }
    busyReview = true; rosterGrid?.setData({ disabled: true }); syncAdminControls(); $('savePlayerReview').disabled = true;
    try {
      const snapshot = await api('admin_review_player', { team_id: teamId, player_id: id, review_status: reviewStatus, review_note: note, expected_updated_at: updatedAt });
      $('playerDialog').close();
      if (current?.team.id === teamId) acceptSnapshot(snapshot); else snapshots.set(teamId, snapshot);
      message('Revisión del jugador guardada.', 'success');
    } catch (error) { $('playerFeedback').textContent = error.status === 409 ? 'Los antecedentes cambiaron. Esta revisión no se guardó. Cierra esta ventana, actualiza el expediente y revisa la versión vigente.' : error.message || 'No se pudo guardar la revisión.'; }
    finally { busyReview = false; $('savePlayerReview').disabled = false; rosterGrid?.setData({ disabled: busyView }); syncAdminControls(); }
  }
  async function reviewSubmission(status) {
    if (!current || busyReview || busyRoster || busyView) return;
    if (rosterGrid?.hasUnsavedChanges()) { message('Guarda o descarta las filas pendientes antes de revisar el expediente. La revisión debe corresponder a los datos guardados.', 'warning'); return; }
    const teamId = current.team.id, note = $('reviewNote').value.trim(), updatedAt = current.submission?.updated_at;
    if (note.length > 2500 || (note.length < 5 && (status === 'observed' || checks(current).warnings.length > 0))) {
      message('Escribe la observación o el criterio con que resolviste las alertas usando entre 5 y 2.500 caracteres antes de guardar.', 'warning'); $('reviewNote').focus(); return;
    }
    busyReview = true; rosterGrid?.setData({ disabled: true }); syncAdminControls();
    try {
      const snapshot = await api('admin_review', { team_id: teamId, status, review_note: note, expected_updated_at: updatedAt });
      if (current?.team.id === teamId) acceptSnapshot(snapshot); else snapshots.set(teamId, snapshot);
      message(status === 'approved' ? 'Expediente marcado como revisado por la organización. La habilitación deportiva, sanitaria y federativa se verifica por separado.' : 'Observaciones guardadas y disponibles para el delegado en su portal.', 'success');
    } catch (error) { handleError(error); }
    finally { busyReview = false; if (current) renderDossier(true); }
  }
  function exportRoster() {
    if (!current) return;
    if (rosterGrid?.hasUnsavedChanges()) { message('Guarda o descarta las filas pendientes antes de exportar la nómina.', 'warning'); return; }
    const rows = [['Club', 'Nombre completo', 'Documento', 'Número documento', 'Fecha nacimiento', 'Edad al evento', 'Cumple en 2026', 'Nacionalidad', 'Camiseta', 'Contacto emergencia', 'Teléfono emergencia', 'Chile Rugby declarado', 'Cobertura declarada', 'Prestador', 'Vigencia declarada', 'Firma declarada', 'Revisión organización', 'Observación revisión', 'Observación club'],
      ...(current.players || []).map(p => [current.team.name, p.full_name, p.document_type, p.document_number, p.birth_date, P.ageOnEvent(p.birth_date), yearAge(p.birth_date), p.nationality, p.jersey_number, p.emergency_contact, p.emergency_phone, federationNames[p.federation_status] || 'Pendiente', coverageNames[p.coverage_type] || 'Pendiente', p.insurance_provider, p.insurance_valid_until, p.signature_declared ? 'Sí' : 'Pendiente', label(p.review_status || 'pending'), p.review_note, p.notes])];
    const safeName = String(current.team.name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 70);
    P.downloadCSV('Copa_FUFY_2026_Nomina_' + safeName + '.csv', rows);
  }

  rosterGrid = Grid.create($('rosterGrid'), {
    onSave: saveRosterPlayer,
    onDelete: removeRosterPlayer,
    onMore: openPlayerData,
    onReview: player => reviewPlayer(player.id),
    onDocuments: showPlayerDocuments,
    onSnapshot: snapshot => acceptSnapshot(snapshot),
    onDirtyChange: count => { $('rosterDirty').textContent = count ? count + (count === 1 ? ' fila tiene cambios sin guardar.' : ' filas tienen cambios sin guardar.') : 'Sin filas pendientes de guardar.'; },
    onBusyChange: busy => { busyRoster = busy; syncAdminControls(); },
    onError: (text, error) => mutationError(error || new Error(text))
  });

  $('teamsBody').addEventListener('click', event => {
    const button = event.target.closest('button[data-action]'); if (!button) return;
    if (button.disabled || busyRoster || busyReview || busyView) return;
    const team = teams.find(t => t.id === button.dataset.team); if (!team) return;
    if (button.dataset.action === 'open') openTeam(team.id);
    if (button.dataset.action === 'invite') invite(team);
    if (button.dataset.action === 'revoke') revoke(team);
  });
  $('addPlayer').addEventListener('click', () => { if (!busyRoster && !busyReview && !busyView) rosterGrid.focusEmptyRow(); });
  $('documents').addEventListener('click', event => { const button = event.target.closest('button[data-document]'); if (button) openDocument(button.dataset.document, button); });
  $('refresh').addEventListener('click', () => loadTeams());
  $('refreshDossier').addEventListener('click', () => { if (current) openTeam(current.team.id, { focus: false }); });
  $('closeDossier').addEventListener('click', () => {
    if (busyRoster || busyReview || busyView) return;
    if (rosterGrid.hasUnsavedChanges() && !window.confirm('Hay filas con cambios sin guardar. ¿Descartarlos y cerrar este expediente?')) return;
    viewSerial++; current = null; rosterGrid.reset(); $('dossier').hidden = true; $('overview').scrollIntoView({ behavior: 'smooth' }); syncAdminControls();
  });
  $('exportRoster').addEventListener('click', exportRoster);
  $('printDossier').addEventListener('click', () => { if (rosterGrid.hasUnsavedChanges()) message('Guarda o descarta las filas pendientes antes de imprimir la nómina.', 'warning'); else window.print(); });
  $('lockRoster').addEventListener('click', lock); $('lockAllRosters').addEventListener('click', lockAll);
  $('observeSubmission').addEventListener('click', () => reviewSubmission('observed'));
  $('approveSubmission').addEventListener('click', () => reviewSubmission('approved'));
  $('cancelConfirm').addEventListener('click', () => $('confirmDialog').close());
  $('confirmDialog').addEventListener('close', () => { confirmAction = null; });
  $('confirmDialog').addEventListener('cancel', event => { if ($('acceptConfirm').disabled) event.preventDefault(); });
  $('acceptConfirm').addEventListener('click', async () => {
    if (!confirmAction || $('acceptConfirm').disabled) return;
    const action = confirmAction; $('acceptConfirm').disabled = true; $('cancelConfirm').disabled = true; $('confirmFeedback').textContent = 'Guardando…';
    try { await action(); }
    catch (error) { $('confirmFeedback').textContent = error.message || 'No se pudo completar la operación.'; }
    finally { $('acceptConfirm').disabled = false; $('cancelConfirm').disabled = false; }
  });
  $('copyInvite').addEventListener('click', () => copyInvite('inviteUrl'));
  $('copyInviteKey').addEventListener('click', () => copyInvite('inviteKey'));
  $('closeInvite').addEventListener('click', () => $('inviteDialog').close());
  $('inviteDialog').addEventListener('close', () => { $('inviteKey').value = ''; $('inviteUrl').value = ''; $('copyFeedback').textContent = ''; });
  $('cancelPlayer').addEventListener('click', () => $('playerDialog').close());
  $('playerDialog').addEventListener('close', () => { currentPlayer = null; $('playerReviewNote').value = ''; });
  $('playerReviewForm').addEventListener('submit', savePlayerReview);
  $('cancelPlayerData').addEventListener('click', () => $('playerDataDialog').close());
  $('playerDataDialog').addEventListener('close', () => { moreContext = null; $('playerDataForm').reset(); });
  $('playerDataForm').addEventListener('submit', applyPlayerData);
  $('exceptionForm').addEventListener('submit', saveException);
  $('cancelException').addEventListener('click', () => { if (!busyException) $('exceptionDialog').close(); });
  $('exceptionDialog').addEventListener('cancel', event => { if (busyException) event.preventDefault(); });
  $('exceptionDialog').addEventListener('close', () => {
    const pending = pendingException; pendingException = null; $('exceptionForm').reset(); $('clubApprovals').textContent = ''; $('exceptionFeedback').textContent = '';
    if (pending) pending.reject(cancelledOperation());
  });
  window.addEventListener('beforeunload', event => { if (rosterGrid.hasUnsavedChanges() || busyRoster) { event.preventDefault(); event.returnValue = ''; } });
  $('logout').addEventListener('click', async () => {
    if (busyRoster || busyReview || busyView) return;
    if (rosterGrid.hasUnsavedChanges() && !window.confirm('Hay filas con cambios sin guardar. ¿Descartarlos y cerrar sesión?')) return;
    $('logout').disabled = true;
    const wasKeyAccess = !!adminKey;
    clearKey(); clearPrivateView();
    try { if (!wasKeyAccess && client) await client.auth.signOut({ scope: 'local' }); }
    finally {
      $('logout').disabled = false;
      $('authDescription').textContent = 'Ingresa tu clave de Copa FUFY para revisar y administrar los cuatro clubes.';
      message('Acceso cerrado. Puedes volver a ingresar con tu clave.');
      $('adminAccessKey').focus();
    }
  });
  $('adminKeyForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (busyAccess || busyTeams) return;
    const key = P.normalizeAccessKey($('adminAccessKey').value, 'admin');
    if (!key) { message('Revisa la clave de superadministrador: comienza con ADMIN y tiene cinco grupos de cuatro caracteres.', 'error'); $('adminAccessKey').focus(); return; }
    busyAccess = true; $('adminKeySubmit').disabled = true;
    authEpoch++; adminKey = key;
    try { await loadTeams(); }
    finally { busyAccess = false; $('adminKeySubmit').disabled = false; }
  });
  async function initializeAccess() {
    if (adminKey) { await loadTeams(); return; }
    try {
      const result = client ? await client.auth.getSession() : null;
      if (result?.data?.session?.access_token) { await loadTeams(); return; }
    } catch { /* A key does not require an existing account session. */ }
    $('authHelp').hidden = false;
    message('Ingresa tu clave para consultar y controlar los cuatro clubes.');
  }
  initializeAccess();
})();
