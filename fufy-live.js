/* Public Copa FUFY scoreboard. Reads only the published sports feed. */
(function () {
  'use strict';

  var instance = null;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var kinds = {
    try: { label: 'Try', points: 5 }, conversion: { label: 'Conversión', points: 2 },
    penalty: { label: 'Penal', points: 3 }, drop_goal: { label: 'Drop', points: 3 },
    penalty_try: { label: 'Try penal', points: 7 },
    yellow_card: { label: 'Tarjeta amarilla', points: 0 }, red_card: { label: 'Tarjeta roja', points: 0 }
  };
  var clock = new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });
  var matchFields = 'id,match_no,round_no,starts_at,status,home_team_id,away_team_id,home_score,away_score,home_tries,away_tries,home_yellow,away_yellow,home_red,away_red,updated_at,desk_enabled,desk_phase';
  var eventFields = 'id,project_id,match_id,team_id,player_id,player_name,jersey_number,kind,points,period,match_minute,created_at,voided_at';

  function setText(id, text) { var node = $(id); if (node) node.textContent = text; }
  function number(value) { return Number.isInteger(value) && value >= 0 ? value : null; }
  function hasScore(match) { return ['in_progress', 'final'].includes(match.status); }
  function phase(match) {
    if (match.status === 'cancelled') return 'Cancelado';
    if (match.status === 'final') return 'Finalizado';
    if (match.desk_phase === 'suspended') return 'Pausado';
    if (match.status === 'in_progress') {
      return match.desk_phase === 'finished' ? 'Cierre de acta' : 'En juego';
    }
    return 'Por jugar';
  }
  function eventMinute(event) {
    var minute = number(event.match_minute);
    return minute == null ? '—' : minute + '′';
  }
  function withTimeout(promise) {
    return new Promise(function (resolve, reject) {
      var timer = window.setTimeout(function () { reject(new Error('La consulta demoró más de lo esperado.')); }, 12000);
      Promise.resolve(promise).then(function (value) { window.clearTimeout(timer); resolve(value); }, function (error) { window.clearTimeout(timer); reject(error); });
    });
  }

  function Live(options) {
    this.client = options.client;
    this.project = options.project;
    this.clubs = options.clubs || [];
    this.matches = [];
    this.events = [];
    this.loaded = false;
    this.loading = false;
    this.stopped = true;
    this.queued = false;
    this.channel = null;
    this.channelState = 'CONNECTING';
    this.confirmedAt = null;
    this.failed = false;
    this.failureDetail = '';
    this.timer = null;
    this.debounce = null;
    this.generation = 0;
    this.fingerprint = '';
  }

  Live.prototype.name = function (id) {
    var team = this.clubs.find(function (club) { return club.id === id; });
    return team ? team.name : 'Equipo por confirmar';
  };
  Live.prototype.playerLabel = function (event) {
    if (event.kind === 'penalty_try') return 'Anotación del equipo';
    var jersey = number(event.jersey_number);
    var name = String(event.player_name || '').trim();
    return name ? name + (jersey == null ? '' : ' · N° ' + jersey) : jersey == null ? 'Jugador por identificar' : 'Camiseta N° ' + jersey;
  };
  Live.prototype.connection = function () {
    var offline = window.navigator.onLine === false;
    var badge = $('publicLiveConnection');
    var text = offline ? 'Sin conexión' : this.failed ? 'Reconectando' : document.hidden ? 'En pausa' :
      !this.loaded ? 'Conectando con la mesa' : this.channelState === 'SUBSCRIBED' ? 'Actualización en vivo' : 'Actualización cada 5 s';
    if (badge) {
      badge.textContent = text;
      badge.className = 'fl-connection' + (offline || this.failed ? ' fl-connection--warning' : this.loaded && !document.hidden ? ' fl-connection--ready' : '');
    }
    var alert = $('publicLiveAlert');
    if (alert) {
      alert.hidden = !(offline || this.failed);
      alert.textContent = (offline ? 'Se perdió la conexión. ' : 'No pudimos confirmar una actualización. ' + (this.failureDetail ? this.failureDetail + ' ' : '')) +
        (this.loaded ? 'Se conserva el último dato recibido de la mesa de control.' : 'Los resultados aparecerán cuando podamos consultar la mesa de control.') +
        ' Volveremos a intentarlo automáticamente.';
    }
    var updated = $('publicLiveUpdated');
    if (updated && this.confirmedAt) {
      updated.textContent = clock.format(this.confirmedAt) + ' · hora de Arica';
      updated.dateTime = this.confirmedAt.toISOString();
      updated.title = 'Última consulta confirmada: ' + this.confirmedAt.toLocaleString('es-CL', { timeZone: 'America/Santiago' });
    }
    var refresh = $('publicLiveRefresh');
    if (refresh) { refresh.disabled = this.loading; refresh.textContent = this.loading ? 'Actualizando…' : 'Actualizar'; }
  };

  Live.prototype.eventHTML = function (event) {
    var kind = kinds[event.kind];
    if (!kind) return '';
    var card = event.kind === 'yellow_card' ? ' fl-event--yellow' : event.kind === 'red_card' ? ' fl-event--red' : '';
    if (event.voided_at) card += ' fl-event--voided';
    return '<li class="fl-event' + card + '"><span class="fl-event-minute">' + esc(eventMinute(event)) + '</span><div><strong>' + esc(kind.label) +
      (kind.points ? ' <span class="fl-event-points">+' + kind.points + '</span>' : '') +
      (event.voided_at ? ' <span class="fl-void-label">Anulado</span>' : '') + '</strong><span>' + esc(this.playerLabel(event)) +
      '</span><small>' + esc(this.name(event.team_id)) + '</small></div></li>';
  };

  Live.prototype.renderMatches = function () {
    var node = $('publicFixtureGrid');
    if (!node) return;
    var opened = new Set(Array.from(node.querySelectorAll('details[open]')).map(function (detail) { return detail.dataset.flMatch; }));
    var focused = document.activeElement && node.contains(document.activeElement) ? document.activeElement.closest('details') : null;
    var focusId = focused && focused.dataset.flMatch;
    var self = this;
    node.innerHTML = this.matches.length ? this.matches.map(function (match) {
      var active = match.status === 'in_progress';
      var score = hasScore(match);
      var home = number(match.home_score), away = number(match.away_score);
      var label = phase(match);
      var events = self.events.filter(function (event) { return event.match_id === match.id; }).sort(function (a, b) {
        return (a.period || 1) - (b.period || 1) || (a.match_minute == null ? 121 : a.match_minute) - (b.match_minute == null ? 121 : b.match_minute) || String(a.created_at).localeCompare(String(b.created_at));
      });
      var time = match.starts_at && !Number.isNaN(new Date(match.starts_at).getTime()) ? window.FUFY_LEAGUE.time(match) : 'Hora por confirmar';
      return '<article class="fl-match' + (active ? ' fl-match--active' : '') + '"><div class="fl-match-top"><span>PARTIDO ' + esc(match.match_no) +
        ' · ' + esc(time) + '</span><span class="fl-phase' + (active ? ' fl-phase--live' : match.status === 'final' ? ' fl-phase--final' : '') + '">' + esc(label) + '</span></div>' +
        '<h3 class="fl-sr-only">' + esc(self.name(match.home_team_id)) + ' contra ' + esc(self.name(match.away_team_id)) + '</h3>' +
        '<div class="fl-scoreboard"><div class="fl-team"><strong>' + esc(self.name(match.home_team_id)) + '</strong></div><div class="fl-score" aria-label="' +
        esc(score ? (home == null ? 'Por confirmar' : home) + ' a ' + (away == null ? 'por confirmar' : away) : 'Partido sin resultado') + '">' +
        (score ? '<b>' + (home == null ? '—' : home) + '</b><span>–</span><b>' + (away == null ? '—' : away) + '</b>' : '<span class="fl-versus">VS</span>') +
        '</div><div class="fl-team fl-team--away"><strong>' + esc(self.name(match.away_team_id)) + '</strong></div></div>' +
        '<p class="fl-match-caption">' + (match.status === 'cancelled' ? 'Encuentro cancelado por la organización.' :
        active ? 'Marcador registrado por la mesa de control.' : match.status === 'final' ? 'Resultado final registrado.' : 'El marcador se mostrará cuando comience el partido.') + '</p>' +
        (events.length ? '<details class="fl-match-events" data-fl-match="' + esc(match.id) + '"' + (opened.has(match.id) ? ' open' : '') + '><summary>Eventos del partido <span>' + events.length + '</span></summary><ol class="fl-events">' + events.map(function (event) { return self.eventHTML(event); }).join('') + '</ol></details>' : '') + '</article>';
    }).join('') : '<div class="fl-empty">La mesa todavía no ha publicado los partidos.</div>';
    if (focusId) {
      var target = Array.from(node.querySelectorAll('details')).find(function (detail) { return detail.dataset.flMatch === focusId; });
      if (target) target.querySelector('summary').focus({ preventScroll: true });
    }
  };

  Live.prototype.renderStandings = function () {
    var table = window.FUFY_LEAGUE.standings(this.clubs, this.matches);
    var body = $('publicStandingsBody');
    if (body) body.innerHTML = table.rows.length ? table.rows.map(function (row) {
      return '<tr><td>' + row.pos + '</td><th scope="row">' + esc(row.name) + '</th>' + ['pj', 'pg', 'pe', 'pp', 'pf', 'pc', 'dif'].map(function (key) {
        return '<td>' + row[key] + '</td>';
      }).join('') + '<td><strong>' + row.pts + '</strong></td></tr>';
    }).join('') : '<tr><td colspan="10">Los equipos se publicarán cuando la organización los confirme.</td></tr>';
    setText('publicTableStatus', table.played + ' de ' + this.matches.length + ' partidos finalizados. La tabla incorpora únicamente resultados finales; los marcadores en juego aún no suman puntos.' +
      (table.needsTryReview ? ' La mesa revisará los tries pendientes para los desempates.' : ''));
  };

  Live.prototype.renderScorers = function () {
    var self = this, scores = new Map();
    this.events.forEach(function (event) {
      var kind = kinds[event.kind];
      if (event.voided_at || !event.player_id || !kind || !kind.points || event.kind === 'penalty_try') return;
      if (!scores.has(event.player_id)) scores.set(event.player_id, {
        name: event.player_name || self.playerLabel(event), team: self.name(event.team_id), points: 0,
        try: 0, conversion: 0, penalty: 0, drop_goal: 0
      });
      var row = scores.get(event.player_id);
      row.points += kind.points;
      row[event.kind]++;
    });
    var rows = Array.from(scores.values()).sort(function (a, b) { return b.points - a.points || b.try - a.try || a.name.localeCompare(b.name, 'es'); });
    var rank = 0, previousPoints = null;
    var body = $('publicScorersBody');
    if (body) body.innerHTML = rows.length ? rows.map(function (row, index) {
      if (row.points !== previousPoints) rank = index + 1;
      previousPoints = row.points;
      return '<tr><td>' + rank + '</td><th scope="row">' + esc(row.name) + '<small>' + esc(row.team) + '</small></th><td>' + row.try +
        '</td><td>' + row.conversion + '</td><td>' + row.penalty + '</td><td>' + row.drop_goal + '</td><td><strong>' + row.points + '</strong></td></tr>';
    }).join('') : '<tr><td colspan="7" class="fl-empty">Aún no hay anotaciones individuales registradas.</td></tr>';
  };

  Live.prototype.render = function () {
    this.renderMatches();
    this.renderStandings();
    this.renderScorers();
    var active = this.matches.filter(function (match) { return match.status === 'in_progress'; }).length;
    var finals = this.matches.filter(function (match) { return window.FUFY_LEAGUE.isFinal(match); }).length;
    setText('publicLiveSummary', active ? active + (active === 1 ? ' partido en curso' : ' partidos en curso') + ' · ' + finals + ' finalizados' : finals ? finals + ' partidos finalizados · consulta los resultados' : 'La mesa publicará los marcadores al iniciar los encuentros.');
    var recent = $('publicRecentEvents');
    var self = this;
    if (recent) recent.innerHTML = this.events.length ? this.events.slice().sort(function (a, b) { return String(b.voided_at || b.created_at).localeCompare(String(a.voided_at || a.created_at)); }).slice(0, 8).map(function (event) { return self.eventHTML(event); }).join('') : '<li class="fl-empty">Los tries, puntos y tarjetas aparecerán aquí cuando los registre la mesa.</li>';
    var league = (this.project.public_details || {}).league || {};
    setText('publicMatchesNote', (league.fixture_status === 'approved' ? 'Fixture ratificado por la organización.' : 'Fixture propuesto: el orden y los horarios siguen sujetos a ratificación.') + ' Marcadores y eventos publicados desde la mesa de control. Los cambios y correcciones se actualizan en esta página.');
  };

  Live.prototype.fetchEvents = async function () {
    var rows = [];
    for (var offset = 0; offset <= 10000; offset += 1000) {
      // A one-row overflow probe distinguishes an exact 10,000 rows from truncation.
      var end = Math.min(offset + 999, 10000);
      var page = await this.client.from('fufy_match_events').select(eventFields)
        .eq('project_id', this.project.id).order('created_at', { ascending: true }).order('id', { ascending: true }).range(offset, end);
      if (page.error || !Array.isArray(page.data)) throw new Error('No se pudo consultar el historial deportivo completo.');
      rows = rows.concat(page.data);
      if (rows.length > 10000) {
        var limitError = new Error('El historial deportivo supera los 10.000 registros.');
        limitError.publicMessage = 'El historial deportivo supera los 10.000 registros; la mesa debe revisar su publicación para mostrarlo completo.';
        throw limitError;
      }
      if (page.data.length < end - offset + 1) return { data: rows };
    }
    return { data: rows };
  };

  Live.prototype.refresh = async function () {
    if (this.stopped || document.hidden || window.navigator.onLine === false) { this.connection(); return; }
    if (this.loading) { this.queued = true; return; }
    this.loading = true;
    this.connection();
    var generation = this.generation;
    try {
      var results = await withTimeout(Promise.all([
        this.client.from('fufy_matches').select(matchFields).eq('project_id', this.project.id).order('match_no'),
        this.fetchEvents()
      ]));
      if (this.stopped || generation !== this.generation) return;
      results.forEach(function (result) { if (result.error || !Array.isArray(result.data)) throw new Error('Los datos de la mesa no están disponibles.'); });
      var matches = results[0].data;
      var eligible = new Set(matches.filter(hasScore).map(function (match) { return match.id; }));
      var deduplicated = new Map();
      results[1].data.forEach(function (event) {
        if (event.id && eligible.has(event.match_id) && kinds[event.kind]) deduplicated.set(event.id, event);
      });
      var events = Array.from(deduplicated.values());
      var fingerprint = JSON.stringify([matches, events]);
      this.matches = matches;
      this.events = events;
      this.loaded = true;
      this.failed = false;
      this.failureDetail = '';
      this.confirmedAt = new Date();
      if (fingerprint !== this.fingerprint) { this.fingerprint = fingerprint; this.render(); }
    } catch (error) {
      if (!this.stopped && generation === this.generation) {
        this.failed = true;
        this.failureDetail = error && error.publicMessage ? error.publicMessage : '';
        if (!this.loaded) {
          setText('publicLiveSummary', 'Esperando datos confirmados de la mesa de control.');
          setText('publicTableStatus', 'La clasificación se mostrará cuando se reciban los resultados.');
        }
      }
    } finally {
      if (generation === this.generation) {
        this.loading = false;
        this.connection();
        if (this.queued) { this.queued = false; this.schedule(); }
      }
    }
  };

  Live.prototype.schedule = function () {
    if (this.stopped) return;
    window.clearTimeout(this.debounce);
    var self = this;
    this.debounce = window.setTimeout(function () { self.refresh(); }, 250);
  };
  Live.prototype.subscribe = function () {
    if (this.stopped || this.channel || window.navigator.onLine === false) return;
    var self = this;
    try {
      this.channel = this.client.channel('fufy-public-live-' + this.project.id)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'fufy_matches', filter: 'project_id=eq.' + this.project.id }, function () { self.schedule(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'fufy_match_events', filter: 'project_id=eq.' + this.project.id }, function () { self.schedule(); })
        .subscribe(function (status) {
          if (self.stopped) return;
          self.channelState = status;
          self.connection();
          if (status === 'SUBSCRIBED') self.schedule();
        });
    } catch (error) { this.channelState = 'CHANNEL_ERROR'; this.connection(); }
  };
  Live.prototype.resume = function () {
    if (!this.stopped) { this.refresh(); return; }
    this.stopped = false;
    this.channelState = 'CONNECTING';
    this.subscribe();
    var self = this;
    this.timer = window.setInterval(function () { self.refresh(); }, 5000);
    this.refresh();
  };
  Live.prototype.stop = function () {
    this.stopped = true;
    this.generation++;
    this.loading = false;
    this.queued = false;
    window.clearInterval(this.timer);
    window.clearTimeout(this.debounce);
    if (this.channel) { this.client.removeChannel(this.channel); this.channel = null; }
  };

  function unavailable(message) {
    setText('publicLiveConnection', 'Datos por confirmar');
    setText('publicLiveSummary', message || 'No pudimos consultar la mesa de control. Actualiza esta página para volver a intentarlo.');
    var button = $('publicLiveRefresh');
    if (button) { button.disabled = false; button.onclick = function () { window.location.reload(); }; }
  }

  window.FUFY_LIVE = Object.freeze({
    start: function (options) {
      if (!options || !options.client || !options.project || !window.FUFY_LEAGUE) { unavailable(); return; }
      if (instance) instance.stop();
      instance = new Live(options);
      var button = $('publicLiveRefresh');
      if (button) button.onclick = function () { instance.refresh(); };
      instance.resume();
    },
    unavailable: unavailable
  });
  document.addEventListener('visibilitychange', function () { if (instance) { instance.connection(); if (!document.hidden) instance.refresh(); } });
  window.addEventListener('online', function () { if (instance) { instance.subscribe(); instance.refresh(); } });
  window.addEventListener('offline', function () { if (instance) instance.connection(); });
  window.addEventListener('pagehide', function () { if (instance) instance.stop(); });
  window.addEventListener('pageshow', function (event) { if (event.persisted && instance) instance.resume(); });
})();
