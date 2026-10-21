/* Copa FUFY: private shift access, an auditable match log and one-time key display. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const league = window.FUFY_LEAGUE;
  if (!league || !window.GIGANTES_SUPABASE_URL || !window.GIGANTES_SUPABASE_PUBLISHABLE_KEY) {
    $('md-message').hidden = false;
    $('md-message').textContent = 'No se pudo cargar la mesa. Comprueba la conexión y vuelve a abrir esta página.';
    $('md-login-fields').disabled = true;
    return;
  }
  const esc = league.escape;
  const TOKEN_KEY = 'fufy-desk-token-v1';
  const endpoint = window.GIGANTES_SUPABASE_URL.replace(/\/$/, '') + '/functions/v1/fufy-match-desk';
  const kinds = {
    try: { label: 'Try', points: 5 }, conversion: { label: 'Conversión', points: 2 },
    penalty: { label: 'Penal', points: 3 }, drop_goal: { label: 'Drop', points: 3 },
    penalty_try: { label: 'Try penal', points: 7 }, yellow_card: { label: 'Tarjeta amarilla', points: 0 },
    red_card: { label: 'Tarjeta roja', points: 0 }
  };
  const reviewLabels = { pending: 'Revisión pendiente', observed: 'Con observaciones', reviewed: 'Antecedentes revisados' };
  const actionLabels = { login: 'Inicio de turno', logout: 'Fin de turno', rotate: 'Renovación de clave', rotate_access: 'Renovación de clave', admin_rotate: 'Renovación de clave', start: 'Inicio de partido', suspend: 'Suspensión', resume: 'Reanudación', finish: 'Acta finalizada', reopen: 'Acta reabierta', add_event: 'Evento registrado', void_event: 'Evento anulado' };
  const state = { token: '', snapshot: null, selected: null, deskBusy: false, readBusy: false, adminBusy: false, admin: null, pending: null, event: null, confirmation: null, lastSync: null, epoch: 0 };
  let adminClient = null;

  function notice(text, kind = '') {
    $('md-message').textContent = text;
    $('md-message').className = 'md-notice' + (kind ? ' md-notice--' + kind : '');
    $('md-message').hidden = !text;
  }
  function dateTime(value) {
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('es-CL', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Santiago' }).format(date) : 'Sin registro';
  }
  function time(value) {
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/Santiago' }).format(date) : '—';
  }
  const teamName = id => state.snapshot?.teams.find(t => t.id === id)?.name || 'Club sin registro';
  const matchById = id => state.snapshot?.matches.find(m => m.id === id);
  const selectedMatch = () => matchById(state.selected);
  const score = value => Number.isInteger(value) ? String(value) : '—';
  const review = value => reviewLabels[value] || 'Revisión pendiente';
  const canRecord = match => !!match?.desk_enabled && match.status === 'in_progress' && ['playing', 'suspended'].includes(match.desk_phase);
  const hasManualResult = match => ['home_score', 'away_score', 'home_tries', 'away_tries', 'home_yellow', 'away_yellow', 'home_red', 'away_red'].some(key => Number(match?.[key] || 0) !== 0);
  function phase(match) {
    if (match?.desk_enabled) return { playing: 'En juego', suspended: 'Suspendido', finished: 'Acta finalizada', not_started: 'Programado' }[match.desk_phase] || 'Por revisar';
    return { scheduled: 'Programado', in_progress: 'En juego · acta manual', final: 'Finalizado · acta manual', cancelled: 'Suspendido · acta manual' }[match?.status] || 'Por revisar';
  }
  function badge(match) {
    const css = match?.desk_enabled && ['playing', 'suspended', 'finished'].includes(match.desk_phase) ? ' md-badge--' + match.desk_phase : '';
    return '<span class="md-badge' + css + '">' + esc(phase(match)) + '</span>';
  }
  function syncStatus(text, mode) { $('md-sync').textContent = text; $('md-sync').dataset.state = mode || ''; }
  function setToken(token) {
    state.token = token;
    try { if (token) sessionStorage.setItem(TOKEN_KEY, token); else sessionStorage.removeItem(TOKEN_KEY); }
    catch { if (token) notice('Tu turno está abierto, pero este navegador no permite conservarlo al recargar. Termina el turno antes de cerrar la página.', 'warning'); }
  }
  function clearDesk() {
    state.epoch++;
    setToken('');
    state.snapshot = null; state.selected = null; state.pending = null; state.event = null;
    $('md-access').hidden = false; $('md-workspace').hidden = true;
    for (const id of ['md-event-dialog', 'md-roster-dialog']) if ($(id).open) $(id).close();
    if ($('md-confirm-dialog').open && state.confirmation?.type !== 'rotate') $('md-confirm-dialog').close();
    syncControls();
  }
  function sessionError(error) {
    const unresolved = !!state.pending;
    clearDesk();
    notice((error?.message || 'El turno venció o fue cerrado. Ingresa con la clave vigente.') + (unresolved ? ' La última operación no quedó confirmada en esta pantalla: consulta el historial con la organización antes de volver a anotarla con otro turno.' : ''), 'warning');
  }
  async function adminToken() {
    if (!window.supabase) throw new Error('No se pudo cargar el acceso administrativo. Actualiza la página o vuelve al Control Center.');
    if (!adminClient) adminClient = window.supabase.createClient(window.GIGANTES_SUPABASE_URL, window.GIGANTES_SUPABASE_PUBLISHABLE_KEY, { auth: { storage: window.GIGANTES_AUTH_STORAGE, persistSession: true, autoRefreshToken: true } });
    const { data: user, error: userError } = await adminClient.auth.getUser();
    if (userError || !user?.user) { const error = new Error('Inicia sesión en Control Center con una cuenta de organización autorizada.'); error.status = 401; throw error; }
    const { data, error: sessionFailure } = await adminClient.auth.getSession();
    if (sessionFailure || !data?.session?.access_token) { const error = new Error('Tu sesión del Control Center venció. Vuelve a iniciar sesión.'); error.status = 401; throw error; }
    return data.session.access_token;
  }
  async function request(body, mode = 'desk') {
    const headers = { 'Content-Type': 'application/json', apikey: window.GIGANTES_SUPABASE_PUBLISHABLE_KEY };
    if (mode === 'admin') headers.Authorization = 'Bearer ' + await adminToken();
    else if (mode === 'desk') headers['X-Fufy-Desk-Token'] = state.token;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    let response;
    try {
      response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
      let result;
      try { result = await response.json(); } catch { result = null; }
      if (!response.ok || !result || typeof result !== 'object' || Array.isArray(result)) {
        const error = new Error(typeof result?.error === 'string' ? result.error : 'No se pudo confirmar la operación. Revisa la conexión antes de continuar.');
        error.status = response.ok ? 503 : response.status;
        error.uncertain = error.status >= 500;
        throw error;
      }
      return result;
    } catch (error) {
      if (!error.status) { error.status = 0; error.uncertain = true; error.message = 'La conexión no permitió confirmar la respuesta del servidor.'; }
      throw error;
    } finally { clearTimeout(timeout); }
  }
  function acceptSnapshot(snapshot) {
    if (!snapshot?.session?.id || !Array.isArray(snapshot.matches) || !Array.isArray(snapshot.teams) || !Array.isArray(snapshot.players) || !Array.isArray(snapshot.events)) {
      const error = new Error('La mesa recibió una respuesta incompleta. Actualiza para confirmar su estado.'); error.status = 503; error.uncertain = true; throw error;
    }
    state.snapshot = snapshot;
    if (!matchById(state.selected)) state.selected = (snapshot.matches.find(m => m.status === 'in_progress') || snapshot.matches.find(m => m.status === 'scheduled') || snapshot.matches[0])?.id || null;
    state.lastSync = snapshot.server_time || new Date().toISOString();
    $('md-access').hidden = true; $('md-workspace').hidden = false;
    $('md-session-name').textContent = snapshot.session.operator_name;
    $('md-session-time').textContent = 'Inicio: ' + dateTime(snapshot.session.started_at) + ' · Vence: ' + dateTime(snapshot.session.expires_at) + ' · Hora de Chile';
    syncStatus('Actualizado ' + time(state.lastSync), 'online');
    renderFixtures(); renderMatch(); renderStandings();
    if ($('md-roster-dialog').open) renderRosters();
    if ($('md-event-dialog').open) refreshEventPlayers();
    syncControls();
  }
  function renderFixtures() {
    $('md-fixtures').innerHTML = state.snapshot.matches.map(match => '<button type="button" class="md-fixture" data-match="' + esc(match.id) + '" aria-current="' + (match.id === state.selected ? 'true' : 'false') + '"><small>Partido ' + esc(match.match_no) + ' · Ronda ' + esc(match.round_no) + ' · ' + esc(league.time(match)) + '</small><strong>' + esc(teamName(match.home_team_id)) + ' vs ' + esc(teamName(match.away_team_id)) + '</strong><div class="md-fixture-bottom">' + badge(match) + '<span class="md-fixture-score">' + score(match.home_score) + ' – ' + score(match.away_score) + '</span></div></button>').join('') || '<p class="md-small">La organización debe preparar el fixture.</p>';
  }
  function renderMatch() {
    const match = selectedMatch();
    $('md-no-match').hidden = !!match; $('md-match-content').hidden = !match;
    if (!match) return;
    $('md-match-meta').textContent = 'PARTIDO ' + match.match_no + ' · RONDA ' + match.round_no + ' · ' + league.time(match) + ' CHILE';
    $('md-match-title').textContent = teamName(match.home_team_id) + ' vs ' + teamName(match.away_team_id);
    $('md-phase').textContent = phase(match);
    $('md-phase').className = 'md-badge' + (match.desk_enabled && ['playing', 'suspended', 'finished'].includes(match.desk_phase) ? ' md-badge--' + match.desk_phase : '');
    for (const side of ['home', 'away']) {
      $('md-' + side + '-name').textContent = teamName(match[side + '_team_id']);
      $('md-' + side + '-score').textContent = score(match[side + '_score']);
      $('md-' + side + '-stats').textContent = 'Tries: ' + score(match[side + '_tries']) + ' · Amarillas: ' + score(match[side + '_yellow']) + ' · Rojas: ' + score(match[side + '_red']);
    }
    let warning = '';
    if (!match.desk_enabled && (match.status !== 'scheduled' || hasManualResult(match))) warning = 'Este encuentro tiene un acta manual o un resultado previo. La mesa digital no lo importa ni lo sobrescribe. Revisa sus antecedentes en Control Center.';
    else if (match.desk_phase === 'suspended') warning = 'Partido suspendido. Puedes completar hechos pendientes o corregir el registro. Reanuda antes de finalizar el acta.';
    else if (match.desk_phase === 'finished') warning = 'Acta finalizada. Para corregirla, reábrela con un motivo y vuelve a finalizar al terminar la revisión.';
    $('md-match-warning').textContent = warning; $('md-match-warning').hidden = !warning;
    $('md-start').hidden = match.status !== 'scheduled' || (match.desk_enabled && match.desk_phase !== 'not_started');
    $('md-suspend').hidden = !match.desk_enabled || match.desk_phase !== 'playing';
    $('md-resume').hidden = !match.desk_enabled || match.desk_phase !== 'suspended';
    $('md-finish').hidden = !match.desk_enabled || match.desk_phase !== 'playing';
    $('md-reopen').hidden = !match.desk_enabled || match.desk_phase !== 'finished';
    $('md-event-buttons').innerHTML = [match.home_team_id, match.away_team_id].map(teamId => '<section class="md-event-team"><h3>' + esc(teamName(teamId)) + '</h3><div class="md-event-grid">' + Object.entries(kinds).map(([kind, entry]) => '<button type="button" class="md-event-button md-event-button--' + kind + '" data-event-kind="' + kind + '" data-team="' + esc(teamId) + '">' + entry.label + '<span>' + (entry.points ? '+' + entry.points : kind === 'yellow_card' ? 'TA' : 'TR') + '</span></button>').join('') + '</div></section>').join('');
    const events = state.snapshot.events.filter(event => event.match_id === match.id).slice().reverse();
    $('md-events').innerHTML = events.map(event => {
      const player = event.player_name ? (event.jersey_number == null ? '' : '#' + event.jersey_number + ' · ') + event.player_name : 'Anotación del equipo';
      const eventName = kinds[event.kind]?.label || 'Evento';
      return '<article class="md-event' + (event.voided_at ? ' md-event--voided' : '') + '"><div><strong class="md-event-kind">' + esc(eventName) + (Number(event.points) ? ' · ' + esc(event.points) + ' puntos' : '') + ' · ' + esc(teamName(event.team_id)) + '</strong><p>' + esc(player) + '</p><p>' + (event.match_minute == null ? 'Minuto sin indicar' : 'Minuto ' + esc(event.match_minute)) + ' · Registro ' + esc(time(event.created_at)) + '</p>' + (event.voided_at ? '<span class="md-event-mark">ANULADO · ' + esc(time(event.voided_at)) + '</span>' : '') + '</div>' + (!event.voided_at && canRecord(match) ? '<button type="button" class="md-button md-button--secondary md-button--small" data-void="' + esc(event.id) + '" aria-label="Anular ' + esc(eventName + ' de ' + player) + '">Anular</button>' : '') + '</article>';
    }).join('') || '<p class="md-small">Este encuentro todavía no tiene eventos digitales registrados.</p>';
    $('md-match-audit').innerHTML = auditHTML((state.snapshot.audit || []).filter(entry => entry.match_id === match.id), 'No hay movimientos de mesa registrados para este encuentro.');
  }
  function renderStandings() {
    const table = league.standings(state.snapshot.teams, state.snapshot.matches);
    $('md-standings').innerHTML = table.rows.map(row => '<tr><td>' + row.pos + '</td><td>' + esc(row.name) + '</td>' + ['pj', 'pg', 'pe', 'pp', 'pf', 'pc', 'dif', 'tries', 'pts'].map(key => '<td>' + esc(row[key]) + '</td>').join('') + '</tr>').join('');
    $('md-standings-note').textContent = table.played + ' de ' + table.total + ' actas finalizadas. Victoria 4 puntos · empate 2 · derrota 0.' + (table.needsTryReview ? ' Hay actas manuales sin tries completos; la organización debe revisar los desempates.' : '') + ' Los empates no resueltos por los criterios deportivos se revisan con el Comité Organizador.';
  }
  function auditHTML(entries, empty) {
    return entries.map(entry => '<div class="md-audit-item"><strong>' + esc(actionLabels[entry.action] || entry.action || 'Movimiento') + '</strong><p>' + esc(entry.operator_name || 'Organización') + ' · ' + esc(dateTime(entry.created_at)) + '</p>' + (entry.reason ? '<p>' + esc(entry.reason) + '</p>' : '') + '</div>').join('') || '<p class="md-small">' + esc(empty) + '</p>';
  }
  function renderRosters() {
    const match = selectedMatch(); if (!match) return;
    $('md-rosters').innerHTML = [match.home_team_id, match.away_team_id].map(teamId => {
      const players = state.snapshot.players.filter(player => player.team_id === teamId);
      return '<section><h3>' + esc(teamName(teamId)) + ' · ' + players.length + ' jugadores</h3><div class="md-table-scroll" tabindex="0" role="region" aria-label="Nómina de ' + esc(teamName(teamId)) + '"><table><thead><tr><th>Dorsal</th><th>Jugador</th><th>Revisión de antecedentes</th></tr></thead><tbody>' + (players.map(player => '<tr><td>' + esc(player.jersey_number ?? '—') + '</td><td>' + esc(player.full_name) + '</td><td>' + esc(review(player.review_status)) + '</td></tr>').join('') || '<tr><td colspan="3">No hay jugadores en la nómina activa.</td></tr>') + '</tbody></table></div></section>';
    }).join('') + '<p class="md-small">Un antecedente revisado no acredita por sí solo habilitación sanitaria o federativa. Verifica la participación con la organización.</p>';
  }
  function syncControls() {
    const busy = state.deskBusy || state.readBusy || state.adminBusy;
    const blocked = busy || !!state.pending || !state.token;
    const match = selectedMatch();
    $('md-login-fields').disabled = state.deskBusy;
    $('md-refresh').disabled = busy;
    $('md-logout').disabled = blocked;
    $('md-retry').disabled = busy || !state.pending;
    $('md-recovery-refresh').disabled = busy;
    $('md-recovery').hidden = !state.pending?.uncertain;
    $('md-recovery-description').textContent = state.pending ? state.pending.description + ' La respuesta anterior no confirmó si se guardó.' : '';
    for (const name of ['start', 'suspend', 'resume', 'finish', 'reopen']) $('md-' + name).disabled = blocked || (name === 'start' && hasManualResult(match));
    document.querySelectorAll('[data-event-kind], [data-void]').forEach(button => { button.disabled = blocked || !canRecord(match); });
    $('md-event-fields').disabled = state.deskBusy || !!state.pending;
    $('md-save-event').disabled = blocked || !canRecord(matchById(state.event?.matchId));
    $('md-cancel-event').disabled = state.deskBusy;
    $('md-confirm-action').disabled = busy || !!state.pending;
    $('md-reason').disabled = state.deskBusy || state.adminBusy;
    $('md-cancel-confirm').disabled = state.deskBusy || state.adminBusy;
    $('md-admin-load').disabled = state.adminBusy || state.deskBusy;
    $('md-rotate').disabled = busy || !!state.pending;
    $('md-save-event').textContent = state.deskBusy ? 'Confirmando…' : 'Registrar evento';
  }
  async function refresh({ quiet = false } = {}) {
    if (!state.token || state.deskBusy || state.readBusy || state.adminBusy) return false;
    const epoch = state.epoch;
    state.readBusy = true; syncControls();
    if (!quiet) syncStatus('Consultando la mesa…');
    try {
      const snapshot = await request({ action: 'snapshot' });
      if (epoch !== state.epoch) return false;
      acceptSnapshot(snapshot);
      if (!quiet) notice(state.pending ? 'Marcador actualizado. La operación pendiente todavía necesita su confirmación mediante Reintentar la misma operación.' : 'Mesa actualizada desde el servidor.', state.pending ? 'warning' : 'success');
      return true;
    } catch (error) {
      if (epoch !== state.epoch) return false;
      if ([401, 403].includes(error.status)) sessionError(error);
      else { syncStatus('Sin conexión confirmada' + (state.lastSync ? ' · último dato ' + time(state.lastSync) : ''), 'offline'); if (!quiet) notice(error.message, 'warning'); }
      return false;
    } finally { state.readBusy = false; syncControls(); }
  }
  function freshRequestId() { return crypto.randomUUID(); }
  function commandSnapshot(command, extra = {}, origin = '') {
    const match = matchById(extra.match_id || state.selected);
    if (!match || !match.updated_at) throw new Error('Actualiza el partido antes de registrar una operación.');
    const body = { action: 'command', command, request_id: freshRequestId(), match_id: match.id, expected_updated_at: match.updated_at, ...extra };
    const description = 'Partido ' + match.match_no + ' · ' + teamName(match.home_team_id) + ' vs ' + teamName(match.away_team_id) + ': ' + (command === 'add_event' ? kinds[extra.event?.kind]?.label || 'evento' : actionLabels[command] || command) + '.';
    return { body, description, origin, uncertain: false };
  }
  async function executeCommand(pending) {
    if (state.deskBusy || state.readBusy || state.adminBusy || !state.token) return;
    state.pending = pending; state.deskBusy = true; syncControls();
    let mustRefresh = false;
    try {
      const snapshot = await request(pending.body);
      acceptSnapshot(snapshot);
      state.pending = null;
      if (pending.origin === 'event') { state.event = null; $('md-event-form').reset(); if ($('md-event-dialog').open) $('md-event-dialog').close(); }
      if (pending.origin === 'confirm') { state.confirmation = null; $('md-reason').value = ''; if ($('md-confirm-dialog').open) $('md-confirm-dialog').close(); }
      notice(pending.description + ' Operación confirmada y guardada.', 'success');
    } catch (error) {
      if ([401, 403].includes(error.status)) sessionError(error);
      else if (error.uncertain || error.status >= 500 || !error.status) {
        pending.uncertain = true;
        if (pending.origin === 'event' && $('md-event-dialog').open) $('md-event-dialog').close();
        if (pending.origin === 'confirm' && $('md-confirm-dialog').open) $('md-confirm-dialog').close();
        syncStatus('Operación por confirmar', 'offline');
        notice('La respuesta no confirmó esta operación. Usa Reintentar la misma operación; el servidor reconocerá la solicitud y evitará registrarla dos veces.', 'warning');
        $('md-recovery').hidden = false;
        $('md-recovery').scrollIntoView({ block: 'nearest' });
      } else {
        state.pending = null;
        const text = error.status === 409 ? 'El partido cambió en otra mesa. Esta solicitud no se aplicó. Actualiza y comprueba el marcador antes de confirmar una acción nueva.' : error.message;
        const feedback = pending.origin === 'event' ? 'md-event-feedback' : 'md-confirm-feedback';
        $(feedback).textContent = text;
        notice(text, 'warning');
        if (pending.uncertain && pending.origin === 'event' && state.event) $('md-event-dialog').showModal();
        if (pending.origin === 'confirm') { if ($('md-confirm-dialog').open) $('md-confirm-dialog').close(); state.confirmation = null; }
        mustRefresh = error.status === 409 || error.status === 423;
      }
    } finally { state.deskBusy = false; syncControls(); }
    if (mustRefresh) await refresh({ quiet: true });
  }
  function openEvent(kind, teamId) {
    const match = selectedMatch();
    if (!kinds[kind] || !canRecord(match) || state.pending || state.deskBusy || state.readBusy || state.adminBusy || ![match.home_team_id, match.away_team_id].includes(teamId)) return;
    state.event = { kind, teamId, matchId: match.id, rosterKey: '' };
    $('md-event-form').reset();
    $('md-event-feedback').textContent = '';
    $('md-event-title').textContent = kinds[kind].label + (kinds[kind].points ? ' · +' + kinds[kind].points + ' puntos' : '');
    $('md-event-subtitle').textContent = teamName(teamId) + ' · Partido ' + match.match_no + '. El nombre deportivo y el dorsal se muestran en los eventos públicos de la Copa.';
    refreshEventPlayers(); syncControls(); $('md-event-dialog').showModal();
    (kind === 'penalty_try' ? $('md-event-minute') : $('md-event-player')).focus();
  }
  function refreshEventPlayers() {
    if (!state.event || !state.snapshot) return;
    const field = $('md-event-player'), previous = field.value, noPlayer = state.event.kind === 'penalty_try';
    const players = state.snapshot.players.filter(player => player.team_id === state.event.teamId);
    const key = JSON.stringify(players.map(player => [player.id, player.full_name, player.jersey_number, player.review_status]));
    if (key !== state.event.rosterKey || noPlayer) {
      state.event.rosterKey = key;
      field.innerHTML = noPlayer ? '<option value="">Se atribuye al equipo, sin jugador individual</option>' : '<option value="">Selecciona al jugador</option>' + players.map(player => '<option value="' + esc(player.id) + '">' + esc((player.jersey_number == null ? '' : '#' + player.jersey_number + ' · ') + player.full_name + ' · ' + review(player.review_status)) + '</option>').join('');
      if (!noPlayer && players.some(player => player.id === previous)) field.value = previous;
      else if (!noPlayer && previous) $('md-event-feedback').textContent = 'El jugador seleccionado ya no aparece en la nómina actual. Revisa con la organización antes de registrar.';
    }
    field.disabled = noPlayer; field.required = !noPlayer;
    $('md-player-help').textContent = noPlayer ? 'El try penal suma 7 puntos y un try al club; no se asigna a un goleador individual.' : players.length ? 'La revisión de antecedentes no acredita por sí sola habilitación sanitaria o federativa. Verifica la participación con la organización.' : 'No hay jugadores en la nómina activa de este club. La organización debe revisar su nómina en Control Center.';
  }
  async function saveEvent(event) {
    event.preventDefault();
    if (!state.event || state.pending || state.deskBusy || state.readBusy || state.adminBusy) return;
    const context = state.event, match = matchById(context.matchId), playerId = $('md-event-player').value;
    if (!canRecord(match)) { $('md-event-feedback').textContent = 'El estado del partido cambió. Debe estar en juego o suspendido para registrar este hecho.'; return; }
    if (context.kind !== 'penalty_try' && !state.snapshot.players.some(player => player.id === playerId && player.team_id === context.teamId)) { $('md-event-feedback').textContent = 'Selecciona un jugador de la nómina actual de este club.'; return; }
    const minuteValue = $('md-event-minute').value.trim(), minute = minuteValue === '' ? null : Number(minuteValue);
    if (minute !== null && (!/^\d+$/.test(minuteValue) || !Number.isInteger(minute) || minute < 0 || minute > 120)) { $('md-event-feedback').textContent = 'Indica un minuto entero entre 0 y 120, o deja el campo vacío.'; return; }
    $('md-event-feedback').textContent = '';
    try { await executeCommand(commandSnapshot('add_event', { match_id: context.matchId, event: { team_id: context.teamId, player_id: context.kind === 'penalty_try' ? null : playerId, kind: context.kind, period: 1, match_minute: minute } }, 'event')); }
    catch (error) { $('md-event-feedback').textContent = error.message; }
  }
  function openConfirmation(context) {
    if (state.pending || state.deskBusy || state.readBusy || state.adminBusy) return;
    state.confirmation = context;
    $('md-confirm-title').textContent = context.title;
    $('md-confirm-description').textContent = context.description;
    $('md-confirm-action').textContent = context.button || 'Confirmar';
    $('md-reason-field').hidden = !context.minReason;
    $('md-reason').required = !!context.minReason;
    $('md-reason').minLength = context.minReason || 0;
    $('md-reason').value = '';
    $('md-confirm-feedback').textContent = '';
    syncControls(); $('md-confirm-dialog').showModal();
  }
  function confirmMatch(command, eventId) {
    const match = selectedMatch(); if (!match) return;
    const title = actionLabels[command] || 'Confirmar operación';
    const intro = 'Partido ' + match.match_no + ' · ' + teamName(match.home_team_id) + ' vs ' + teamName(match.away_team_id) + '.\n';
    let description, minReason = 0;
    if (command === 'start') description = intro + 'Iniciar activa el acta digital y cierra las nóminas de todos los clubes desde el primer partido del campeonato. Los delegados no podrán modificarlas. Los cambios excepcionales se gestionan en Control Center. Classic: 20 minutos corridos, sin entretiempo.';
    else if (command === 'finish') description = intro + 'Confirma con árbitro y mesa el marcador ' + score(match.home_score) + ' – ' + score(match.away_score) + '. El acta finalizada se incorporará a la tabla de posiciones.';
    else if (command === 'suspend') { description = intro + 'Se detiene el estado de juego y se conserva el marcador. Registra el motivo de la suspensión.'; minReason = 5; }
    else if (command === 'resume') description = intro + 'Reanudar devuelve el acta al estado En juego. Confirma la reanudación con el árbitro.';
    else if (command === 'reopen') { description = intro + 'El acta vuelve a En juego y deja de contar en la tabla hasta que la finalices otra vez. Explica por qué se necesita la corrección.'; minReason = 10; }
    else if (command === 'void_event') {
      const entry = state.snapshot.events.find(item => item.id === eventId && item.match_id === match.id && !item.voided_at);
      if (!entry) return;
      description = intro + 'Anular ' + (kinds[entry.kind]?.label || 'evento') + ' de ' + teamName(entry.team_id) + (entry.player_name ? ' · ' + entry.player_name : '') + '. Se recalculará el marcador y se conservarán el evento y el motivo en el historial.'; minReason = 5;
    } else return;
    openConfirmation({ type: 'command', command, matchId: match.id, expected: match.updated_at, eventId, title, description, minReason, button: command === 'void_event' ? 'Confirmar anulación' : 'Confirmar' });
  }
  async function submitConfirmation(event) {
    event.preventDefault();
    const context = state.confirmation;
    if (!context || state.pending || state.deskBusy || state.readBusy || state.adminBusy) return;
    const reason = $('md-reason').value.replace(/\s+/g, ' ').trim();
    if (context.minReason && (reason.length < context.minReason || reason.length > 1200)) { $('md-confirm-feedback').textContent = 'Escribe un motivo de al menos ' + context.minReason + ' caracteres (máximo 1200).'; return; }
    if (context.type === 'rotate') { await rotateKey(); return; }
    if (context.type === 'logout') { await logout(); return; }
    const match = matchById(context.matchId);
    if (!match || match.updated_at !== context.expected) {
      $('md-confirm-dialog').close(); state.confirmation = null;
      notice('El partido cambió mientras revisabas la confirmación. Comprueba el marcador actual y vuelve a abrir la operación para confirmarla.', 'warning'); return;
    }
    try {
      const extra = { match_id: context.matchId };
      if (context.minReason) extra.reason = reason;
      if (context.eventId) extra.event_id = context.eventId;
      await executeCommand(commandSnapshot(context.command, extra, 'confirm'));
    } catch (error) { $('md-confirm-feedback').textContent = error.message; }
  }
  async function login(event) {
    event.preventDefault(); if (state.deskBusy || state.adminBusy) return;
    const operator = $('md-operator').value.trim(), password = $('md-password').value;
    if (operator.length < 3 || operator.length > 80 || !password) return;
    $('md-password').value = '';
    state.deskBusy = true; syncControls(); notice('Verificando la clave y abriendo tu turno…');
    try {
      const result = await request({ action: 'login', operator_name: operator, password }, 'public');
      if (!/^[a-f0-9]{64}$/.test(result.session_token || '')) throw new Error('No se recibió un acceso de turno válido. Vuelve a ingresar.');
      setToken(result.session_token); state.epoch++;
      acceptSnapshot(result); notice('Turno abierto. Selecciona el encuentro y verifica el marcador antes de registrar.', 'success');
    } catch (error) { if (state.token) clearDesk(); notice(error.message, 'error'); }
    finally { state.deskBusy = false; syncControls(); }
  }
  async function logout() {
    if (state.pending || state.deskBusy) return;
    state.deskBusy = true; syncControls();
    let message = 'Tu turno finalizó. El siguiente operador puede ingresar con su nombre y la clave vigente.';
    try { await request({ action: 'logout' }); }
    catch (error) { if (![401, 403].includes(error.status)) message = 'Se cerró el acceso en este navegador, pero la conexión no confirmó el cierre del turno en el servidor. La organización puede renovar la clave para cerrar todos los turnos.'; }
    finally { state.confirmation = null; if ($('md-confirm-dialog').open) $('md-confirm-dialog').close(); clearDesk(); state.deskBusy = false; syncControls(); notice(message, message.startsWith('Tu turno') ? 'success' : 'warning'); }
  }
  function renderAdmin(result) {
    state.admin = result;
    const access = result.access || {};
    $('md-admin-content').hidden = false;
    $('md-access-state').textContent = (access.configured ? access.active && (!access.expires_at || new Date(access.expires_at) > new Date()) ? 'Clave vigente.' : 'Clave inactiva o vencida.' : 'Todavía no hay una clave configurada.') + (access.expires_at ? ' Vence: ' + dateTime(access.expires_at) + '.' : '') + (access.updated_at ? ' Última renovación: ' + dateTime(access.updated_at) + '.' : '');
    $('md-rotate').textContent = access.configured ? 'Renovar clave' : 'Crear clave';
    $('md-sessions').innerHTML = (result.sessions || []).map(session => '<tr><td>' + esc(session.operator_name) + '</td><td>' + esc(dateTime(session.started_at)) + '</td><td>' + esc(dateTime(session.expires_at)) + '</td><td>' + (session.ended_at ? 'Terminado · ' + esc(dateTime(session.ended_at)) : new Date(session.expires_at) <= new Date() ? 'Vencido' : 'Activo') + '</td></tr>').join('') || '<tr><td colspan="4">Todavía no hay turnos registrados.</td></tr>';
    $('md-admin-audit').innerHTML = auditHTML(result.audit || [], 'Sin movimientos administrativos registrados.');
  }
  async function loadAdmin() {
    if (state.adminBusy || state.deskBusy) return;
    state.adminBusy = true; syncControls(); $('md-admin-message').textContent = 'Verificando tu cuenta del Control Center…';
    try { renderAdmin(await request({ action: 'admin_info' }, 'admin')); $('md-admin-message').textContent = 'Acceso administrativo verificado. La clave vigente no se puede volver a consultar; puedes renovarla con confirmación.'; }
    catch (error) { $('md-admin-message').textContent = error.message; if ([401, 403].includes(error.status)) { $('md-admin-content').hidden = true; state.admin = null; } }
    finally { state.adminBusy = false; syncControls(); }
  }
  async function rotateKey() {
    state.adminBusy = true; syncControls();
    try {
      const result = await request({ action: 'admin_rotate' }, 'admin');
      if (!result.password || typeof result.password !== 'string') { const error = new Error('No se recibió la clave nueva. Consulta el estado administrativo antes de volver a renovarla.'); error.uncertain = true; throw error; }
      const password = result.password; delete result.password;
      renderAdmin(result);
      state.confirmation = null; $('md-confirm-dialog').close();
      if (state.token) clearDesk();
      $('md-new-password').value = password; $('md-copy-feedback').textContent = '';
      $('md-secret-dialog').showModal();
      $('md-admin-message').textContent = 'Clave renovada. Los turnos anteriores se cerraron.';
    } catch (error) {
      $('md-confirm-feedback').textContent = error.uncertain ? 'La respuesta no confirmó si se renovó la clave. Cierra esta confirmación y consulta el estado administrativo. Para generar otra clave, vuelve a confirmar la renovación y el cierre de turnos.' : error.message;
      if (error.uncertain) { $('md-confirm-dialog').close(); state.confirmation = null; $('md-admin-message').textContent = 'Renovación sin respuesta confirmada. Consulta el estado antes de solicitar una nueva clave. Ninguna clave quedó guardada en este navegador.'; }
      if ([401, 403].includes(error.status)) { $('md-admin-content').hidden = true; state.admin = null; }
    } finally { state.adminBusy = false; syncControls(); }
  }
  function openAdminHash() {
    if (!['#administracion', '#md-admin'].includes(location.hash)) return;
    $('md-admin').open = true;
    $('md-admin').scrollIntoView({ block: 'start' });
  }

  $('md-login-form').addEventListener('submit', login);
  $('md-refresh').addEventListener('click', () => refresh());
  $('md-recovery-refresh').addEventListener('click', () => refresh());
  $('md-retry').addEventListener('click', () => { if (state.pending) executeCommand(state.pending); });
  $('md-logout').addEventListener('click', () => openConfirmation({ type: 'logout', title: 'Terminar el turno', description: 'Se cerrará el acceso de ' + (state.snapshot?.session?.operator_name || 'este operador') + '. Para continuar, el siguiente operador debe ingresar con su nombre y la clave vigente.', button: 'Terminar turno' }));
  $('md-fixtures').addEventListener('click', event => {
    const button = event.target.closest('[data-match]'); if (!button || !matchById(button.dataset.match)) return;
    state.selected = button.dataset.match; renderFixtures(); renderMatch(); syncControls();
    $('md-match-title').focus({ preventScroll: true }); $('md-match').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  for (const command of ['start', 'suspend', 'resume', 'finish', 'reopen']) $('md-' + command).addEventListener('click', () => confirmMatch(command));
  $('md-event-buttons').addEventListener('click', event => { const button = event.target.closest('[data-event-kind]'); if (button && !button.disabled) openEvent(button.dataset.eventKind, button.dataset.team); });
  $('md-events').addEventListener('click', event => { const button = event.target.closest('[data-void]'); if (button && !button.disabled) confirmMatch('void_event', button.dataset.void); });
  $('md-event-form').addEventListener('submit', saveEvent);
  $('md-cancel-event').addEventListener('click', () => { if (!state.deskBusy) { state.event = null; $('md-event-dialog').close(); } });
  $('md-event-dialog').addEventListener('cancel', event => { if (state.deskBusy || state.pending) event.preventDefault(); else state.event = null; });
  $('md-confirm-form').addEventListener('submit', submitConfirmation);
  $('md-cancel-confirm').addEventListener('click', () => { if (!state.deskBusy && !state.adminBusy) { state.confirmation = null; $('md-confirm-dialog').close(); } });
  $('md-confirm-dialog').addEventListener('cancel', event => { if (state.deskBusy || state.adminBusy || state.pending) event.preventDefault(); else state.confirmation = null; });
  $('md-view-rosters').addEventListener('click', () => { renderRosters(); $('md-roster-dialog').showModal(); });
  $('md-close-rosters').addEventListener('click', () => $('md-roster-dialog').close());
  $('md-admin-load').addEventListener('click', loadAdmin);
  $('md-rotate').addEventListener('click', () => {
    if (!state.admin) return;
    const active = (state.admin.sessions || []).filter(session => !session.ended_at && new Date(session.expires_at) > new Date()).length;
    openConfirmation({ type: 'rotate', title: state.admin.access?.configured ? 'Renovar clave y cerrar turnos' : 'Crear la clave de la mesa', description: 'Se generará una nueva clave, que se mostrará una sola vez. Se cerrarán todos los turnos existentes (' + active + ' activos en la última consulta). Los operadores deberán ingresar otra vez con la nueva clave. Confirma con la mesa antes de continuar.', button: 'Generar clave y cerrar turnos' });
  });
  $('md-close-secret').addEventListener('click', () => $('md-secret-dialog').close());
  $('md-secret-dialog').addEventListener('close', () => { $('md-new-password').value = ''; $('md-copy-feedback').textContent = ''; });
  $('md-copy-secret').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('md-new-password').value); $('md-copy-feedback').textContent = 'Clave copiada. Entrégala solo a los operadores autorizados.'; }
    catch { $('md-new-password').focus(); $('md-new-password').select(); $('md-copy-feedback').textContent = 'El navegador no permitió copiarla automáticamente. Copia el texto seleccionado.'; }
  });
  window.addEventListener('beforeunload', event => { if (state.pending || state.deskBusy || state.adminBusy) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('online', () => { if (state.token) refresh({ quiet: true }); });
  window.addEventListener('offline', () => syncStatus('Sin conexión · no registres una acción nueva', 'offline'));
  window.addEventListener('hashchange', openAdminHash);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.token) refresh({ quiet: true }); });
  setInterval(() => { if (!document.hidden && state.token) refresh({ quiet: true }); }, 5000);
  try { const stored = sessionStorage.getItem(TOKEN_KEY); if (/^[a-f0-9]{64}$/.test(stored || '')) state.token = stored; else sessionStorage.removeItem(TOKEN_KEY); } catch { /* The operator can still start a turn in this tab. */ }
  syncControls(); openAdminHash();
  if (state.token) { $('md-access').hidden = true; notice('Comprobando el turno guardado en esta pestaña…'); refresh().then(ok => { if (!ok && !state.snapshot) { $('md-access').hidden = false; notice('No se pudo comprobar el turno. Revisa la conexión y actualiza la página antes de abrir otro turno.', 'warning'); } }); }
})();
