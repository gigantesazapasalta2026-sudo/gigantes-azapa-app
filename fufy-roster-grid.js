/* Shared editable roster. Draft rows live only in this page's memory. */
(function () {
  'use strict';

  var instances = 0;
  var fields = [
    'full_name', 'document_type', 'document_number', 'birth_date', 'nationality',
    'jersey_number', 'coverage_type', 'insurance_provider', 'insurance_valid_until',
    'federation_status', 'emergency_contact', 'emergency_phone', 'notes', 'signature_declared'
  ];
  var columns = [
    { field: 'full_name', label: 'Nombre completo', type: 'text', max: 160, required: true, css: 'name' },
    { field: 'document_type', label: 'Tipo documento', options: [['RUT', 'RUT'], ['DNI', 'DNI'], ['Pasaporte', 'Pasaporte'], ['Otro', 'Otro']], css: 'doctype' },
    { field: 'document_number', label: 'N° documento', type: 'text', max: 40, minLength: 3, required: true, css: 'document' },
    { field: 'birth_date', label: 'Nacimiento', type: 'date', min: '1900-01-01', maxDate: '2026-10-24', required: true, css: 'date' },
    { field: 'age', label: 'Edad torneo / 2026', css: 'age' },
    { field: 'nationality', label: 'Nacionalidad', type: 'text', max: 80, css: 'nationality' },
    { field: 'jersey_number', label: 'Camiseta', type: 'number', min: 0, maxNumber: 999, css: 'jersey' },
    { field: 'coverage_type', label: 'Medio de atención', options: [['pending', 'Por informar'], ['insurance', 'Seguro'], ['prevision', 'Previsión de salud'], ['other', 'Otro medio']], css: 'coverage' },
    { field: 'insurance_provider', label: 'Entidad / medio', type: 'text', max: 160, css: 'provider' },
    { field: 'insurance_valid_until', label: 'Vigencia hasta', type: 'date', css: 'date' },
    { field: 'federation_status', label: 'Registro federativo', options: [['pending', 'Por confirmar'], ['declared', 'Declarado por el club'], ['not_applicable', 'No aplica / origen']], css: 'federation' }
  ];
  var esc = function (value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var clone = function (value) { return Object.assign({}, value); };
  var same = function (left, right) { return fields.every(function (f) { return left[f] === right[f]; }); };

  function Grid(container, options) {
    if (!container || typeof container.addEventListener !== 'function') throw new Error('Falta el contenedor de la tabla de jugadores.');
    this.el = container;
    this.options = options || {};
    this.maxRows = 25;
    this.prefix = 'frg-' + (++instances);
    this.sequence = 0;
    this.rows = [];
    this.team = {};
    this.readOnly = false;
    this.disabled = false;
    this.pending = false;
    this.lastDirtyCount = -1;
    this.destroyed = false;
    this.el.classList.add('frg');
    this.handleInput = this.handleInput.bind(this);
    this.handleClick = this.handleClick.bind(this);
    this.el.addEventListener('input', this.handleInput);
    this.el.addEventListener('change', this.handleInput);
    this.el.addEventListener('click', this.handleClick);
    this.setData(this.options);
  }

  Grid.prototype.values = function (player) {
    player = player || {};
    var country = String(this.team.country || '');
    var defaults = {
      document_type: /^(chile|cl)$/i.test(country) ? 'RUT' : 'DNI',
      nationality: country, coverage_type: 'pending', federation_status: 'pending'
    };
    var data = {};
    fields.forEach(function (name) {
      if (name === 'signature_declared') data[name] = player[name] === true;
      else data[name] = player[name] == null ? (defaults[name] || '') : String(player[name]);
    });
    return data;
  };

  Grid.prototype.newRow = function (player) {
    var base = player ? clone(player) : null;
    var values = this.values(player);
    return {
      key: this.prefix + '-r' + (++this.sequence), base: base,
      latest: base, values: values, original: clone(values),
      dirty: false, error: '', remoteChanged: false, removed: false
    };
  };

  Grid.prototype.row = function (key) {
    return this.rows.find(function (row) { return row.key === key; });
  };

  Grid.prototype.payload = function (row) {
    var data = {};
    fields.forEach(function (name) {
      data[name] = name === 'signature_declared' ? row.values[name] === true : String(row.values[name] || '').trim();
    });
    if (row.base && row.base.id) data.id = row.base.id;
    data.jersey_number = data.jersey_number === '' ? null : Number(data.jersey_number);
    data.birth_date = data.birth_date || null;
    data.insurance_valid_until = data.insurance_valid_until || null;
    return data;
  };

  Grid.prototype.setData = function (data) {
    if (this.destroyed) return;
    data = data || {};
    if (data.team) {
      if (this.team.id && data.team.id && this.team.id !== data.team.id) this.reset(false);
      this.team = clone(data.team);
    }
    if (Object.prototype.hasOwnProperty.call(data, 'readOnly')) this.readOnly = Boolean(data.readOnly);
    if (Object.prototype.hasOwnProperty.call(data, 'disabled')) this.disabled = Boolean(data.disabled);
    if (Array.isArray(data.players)) {
      var incoming = new Map(data.players.filter(function (p) { return p && p.id; }).map(function (p) { return [p.id, p]; }));
      var mapped = new Set();
      var self = this;
      this.rows = this.rows.map(function (row) {
        if (!row.base || !row.base.id) {
          if (!row.dirty) {
            row.values = self.values(null);
            row.original = clone(row.values);
          }
          return row;
        }
        var latest = incoming.get(row.base.id);
        if (latest) {
          mapped.add(latest.id);
          row.latest = clone(latest);
          row.removed = false;
          if (row.dirty) {
            row.remoteChanged = Boolean(row.base.updated_at && latest.updated_at && row.base.updated_at !== latest.updated_at);
          } else {
            row.base = clone(latest);
            row.values = self.values(latest);
            row.original = clone(row.values);
            row.remoteChanged = false;
            row.error = '';
          }
          return row;
        }
        if (row.dirty) {
          row.removed = true;
          row.remoteChanged = true;
          row.latest = null;
          return row;
        }
        return self.newRow(null);
      });
      incoming.forEach(function (player, id) {
        if (mapped.has(id)) return;
        var vacant = self.rows.findIndex(function (row) { return !row.base && !row.dirty; });
        var row = self.newRow(player);
        if (vacant >= 0) self.rows[vacant] = row;
        else self.rows.push(row);
      });
      // Refill unused slots; never discard a typed row if a concurrent update adds a player.
      while (this.rows.length < this.maxRows) this.rows.push(this.newRow(null));
      while (this.rows.length > this.maxRows) {
        var extra = this.rows.findIndex(function (row, index) { return index >= self.maxRows && !row.base && !row.dirty; });
        if (extra < 0) break;
        this.rows.splice(extra, 1);
      }
    } else if (!this.rows.length) {
      while (this.rows.length < this.maxRows) this.rows.push(this.newRow(null));
    }
    this.render();
    this.notifyDirty();
  };

  Grid.prototype.dirtyCount = function () {
    return this.rows.filter(function (row) { return row.dirty; }).length;
  };
  Grid.prototype.hasUnsavedChanges = function () { return this.dirtyCount() > 0; };
  Grid.prototype.isBusy = function () { return this.pending; };
  Grid.prototype.getUnsavedRows = function () {
    var self = this;
    return this.rows.filter(function (r) { return r.dirty; }).map(function (r) {
      return { rowKey: r.key, player: self.payload(r), expected_updated_at: r.base && r.base.updated_at };
    });
  };
  Grid.prototype.notifyDirty = function () {
    var count = this.dirtyCount();
    var changed = count !== this.lastDirtyCount;
    this.lastDirtyCount = count;
    if (changed && typeof this.options.onDirtyChange === 'function') this.options.onDirtyChange(count);
  };
  Grid.prototype.notifyBusy = function (busy) {
    this.pending = busy;
    if (typeof this.options.onBusyChange === 'function') this.options.onBusyChange(busy);
  };

  Grid.prototype.age = function (value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return '—';
    var bits = value.split('-').map(Number);
    var inYear = 2026 - bits[0];
    var atEvent = inYear - (bits[1] > 10 || (bits[1] === 10 && bits[2] > 24) ? 1 : 0);
    return '<span' + (inYear < 40 ? ' class="frg-age-alert"' : '') + '>' + esc(atEvent) + ' / ' + esc(inYear) +
      '</span>' + (inYear < 40 ? '<small>Revisar categoría</small>' : '');
  };
  Grid.prototype.reviewLabel = function (row) {
    var state = row.latest && row.latest.review_status;
    return { reviewed: 'Revisado', observed: 'Con observación', pending: 'Por revisar' }[state] || (row.base ? 'Por revisar' : 'Sin guardar');
  };
  Grid.prototype.cell = function (row, column, index) {
    var name = column.field;
    if (name === 'age') return this.age(row.values.birth_date);
    var value = row.values[name];
    if (this.readOnly) {
      if (!row.base && !row.dirty) return '<span class="frg-empty-cell">—</span>';
      if (column.options) {
        var match = column.options.find(function (o) { return o[0] === value; });
        value = match ? match[1] : value;
      }
      if (column.type === 'date' && value) {
        var bits = value.split('-');
        if (bits.length === 3) value = bits[2] + '/' + bits[1] + '/' + bits[0];
      }
      return '<span class="frg-value">' + esc(value || '—') + '</span>';
    }
    var label = column.label + ', fila ' + (index + 1);
    var common = ' data-frg-field="' + esc(name) + '" aria-label="' + esc(label) + '"' +
      ' autocomplete="off"' + (this.disabled || row.saving ? ' disabled' : '') +
      (column.required ? ' required' : '');
    if (column.options) {
      return '<select' + common + '>' + column.options.map(function (option) {
        return '<option value="' + esc(option[0]) + '"' + (option[0] === value ? ' selected' : '') + '>' + esc(option[1]) + '</option>';
      }).join('') + '</select>';
    }
    return '<input type="' + column.type + '"' + common + ' value="' + esc(value) + '"' +
      (column.max ? ' maxlength="' + column.max + '"' : '') +
      (column.minLength ? ' minlength="' + column.minLength + '"' : '') +
      (column.min != null ? ' min="' + esc(column.min) + '"' : '') +
      (column.maxDate ? ' max="' + esc(column.maxDate) + '"' : '') +
      (column.maxNumber != null ? ' max="' + column.maxNumber + '" step="1" inputmode="numeric"' : '') +
      (column.type === 'text' ? ' spellcheck="false"' : '') + '>';
  };

  Grid.prototype.buttons = function (row) {
    var lock = this.disabled || this.pending;
    var result = '';
    if (!this.readOnly) {
      result += '<button type="button" class="frg-button frg-save" data-frg-action="save"' +
        (lock || !row.dirty || row.removed ? ' disabled' : '') + '>' +
        (row.saving ? 'Guardando…' : row.dirty ? 'Guardar fila' : row.base ? 'Guardada' : 'Guardar fila') + '</button>';
    }
    if (typeof this.options.onMore === 'function' && (!this.readOnly || row.base || row.dirty)) {
      result += '<button type="button" class="frg-button" data-frg-action="more"' + (lock ? ' disabled' : '') + '>Más datos</button>';
    }
    if (row.base && typeof this.options.onDocuments === 'function') {
      result += '<button type="button" class="frg-button" data-frg-action="documents"' + (lock ? ' disabled' : '') + '>Documentos</button>';
    }
    if (row.base && typeof this.options.onReview === 'function') {
      result += '<button type="button" class="frg-button" data-frg-action="review"' + (lock ? ' disabled' : '') + '>Revisión</button>';
    }
    if (!this.readOnly && row.dirty) {
      result += '<button type="button" class="frg-button frg-reset" data-frg-action="discard"' + (lock ? ' disabled' : '') + '>' + (row.base ? 'Deshacer' : 'Limpiar') + '</button>';
    }
    if (!this.readOnly && row.base && !row.removed && typeof this.options.onDelete === 'function') {
      result += '<button type="button" class="frg-button frg-remove" data-frg-action="delete"' + (lock ? ' disabled' : '') + '>Quitar</button>';
    }
    return result ? '<div class="frg-actions">' + result + '</div>' : '<span class="frg-empty-cell">—</span>';
  };

  Grid.prototype.rowHTML = function (row, index) {
    var self = this;
    var warning = row.error || (row.removed ? 'Retirado en otro acceso. Se conservaron tus cambios sin guardar.' :
      row.remoteChanged ? 'Esta ficha cambió en otro acceso. Revisa los datos antes de guardar.' : '');
    var html = '<tr data-frg-row="' + row.key + '" class="' +
      (row.dirty ? 'frg-dirty ' : '') + (!row.base ? 'frg-new' : '') + '">' +
      '<th scope="row" class="frg-index">' + (index + 1) + '</th>';
    columns.forEach(function (column) {
      html += '<td class="frg-col-' + column.css + '">' + self.cell(row, column, index);
      if (column.field === 'full_name') html += '<small class="frg-row-status" aria-live="polite">' +
        esc(row.dirty ? 'Cambios sin guardar' : self.reviewLabel(row)) + '</small>';
      html += '</td>';
    });
    html += '<td class="frg-col-actions">' + this.buttons(row) + '</td></tr>';
    html += '<tr data-frg-error-row="' + row.key + '" class="frg-error-row"' + (warning ? '' : ' hidden') +
      '><td colspan="' + (columns.length + 2) + '"><p class="frg-row-error" role="alert">' + esc(warning) + '</p></td></tr>';
    return html;
  };

  Grid.prototype.captureFocus = function () {
    var active = document.activeElement;
    var row = active && this.el.contains(active) ? active.closest('[data-frg-row]') : null;
    var scroll = this.el.querySelector('.frg-scroll');
    return {
      key: row && row.dataset.frgRow, field: active && active.dataset ? active.dataset.frgField : '',
      action: active && active.dataset ? active.dataset.frgAction : '',
      start: active && typeof active.selectionStart === 'number' ? active.selectionStart : null,
      end: active && typeof active.selectionEnd === 'number' ? active.selectionEnd : null,
      top: scroll ? scroll.scrollTop : 0, left: scroll ? scroll.scrollLeft : 0
    };
  };
  Grid.prototype.restoreFocus = function (previous) {
    var scroll = this.el.querySelector('.frg-scroll');
    if (scroll) { scroll.scrollTop = previous.top; scroll.scrollLeft = previous.left; }
    if (!previous.key) return;
    var row = this.el.querySelector('[data-frg-row="' + previous.key + '"]');
    var target = row && (previous.field ? row.querySelector('[data-frg-field="' + previous.field + '"]') :
      previous.action ? row.querySelector('[data-frg-action="' + previous.action + '"]') : null);
    if (target && !target.disabled) {
      target.focus({ preventScroll: true });
      if (previous.start != null && typeof target.setSelectionRange === 'function') {
        try { target.setSelectionRange(previous.start, previous.end); } catch (ignore) { /* Date and number controls. */ }
      }
    }
  };

  Grid.prototype.render = function () {
    if (this.destroyed) return;
    var focus = this.captureFocus();
    var self = this;
    var saved = this.rows.filter(function (r) { return r.base && !r.removed; }).length;
    var dirty = this.dirtyCount();
    this.el.innerHTML = '<div class="frg-toolbar"><div><strong>' + saved + ' / 25 jugadores guardados</strong>' +
      '<span class="frg-dirty-summary" role="status">' + (dirty ? dirty + (dirty === 1 ? ' fila sin guardar' : ' filas sin guardar') : 'Todos los cambios guardados') + '</span></div>' +
      '<span class="frg-scroll-hint">' + (this.readOnly ? 'Nómina cerrada · Consulta de datos' : 'Completa una fila y pulsa Guardar fila') + ' · Desliza la tabla ↔</span></div>' +
      '<div class="frg-scroll" role="region" aria-label="Tabla de 25 jugadores de ' + esc(this.team.name || 'la delegación') + '" tabindex="0">' +
      '<table class="frg-table"><caption class="frg-sr-only">Nómina de jugadores. Nombre completo, identidad y fecha de nacimiento son necesarios para guardar cada fila.</caption>' +
      '<thead><tr><th scope="col" class="frg-index">N°</th>' + columns.map(function (c) {
        return '<th scope="col" class="frg-col-' + c.css + '">' + esc(c.label) + (c.required ? ' <span aria-label="obligatorio">*</span>' : '') + '</th>';
      }).join('') + '<th scope="col" class="frg-col-actions">Acciones</th></tr></thead><tbody>' +
      this.rows.map(function (row, index) { return self.rowHTML(row, index); }).join('') +
      '</tbody></table></div><p class="frg-footnote">' +
      (this.readOnly ? 'La edición de la delegación está cerrada. Cualquier excepción debe resolverla la organización desde Control Center.' :
        '* Nombre, documento y nacimiento son obligatorios para guardar una fila. Los demás antecedentes pueden completarse después. La nómina completa y sus documentos deben quedar listos antes del primer partido del campeonato.') +
      '</p>';
    this.restoreFocus(focus);
  };

  Grid.prototype.refreshRowStatus = function (row) {
    var tr = this.el.querySelector('[data-frg-row="' + row.key + '"]');
    if (!tr) return;
    tr.classList.toggle('frg-dirty', row.dirty);
    var status = tr.querySelector('.frg-row-status');
    if (status) status.textContent = row.dirty ? 'Cambios sin guardar' : this.reviewLabel(row);
    var actions = tr.querySelector('.frg-col-actions');
    if (actions) actions.innerHTML = this.buttons(row);
    var age = tr.querySelector('.frg-col-age');
    if (age) age.innerHTML = this.age(row.values.birth_date);
    var summary = this.el.querySelector('.frg-dirty-summary');
    var count = this.dirtyCount();
    if (summary) summary.textContent = count ? count + (count === 1 ? ' fila sin guardar' : ' filas sin guardar') : 'Todos los cambios guardados';
    this.notifyDirty();
  };

  Grid.prototype.handleInput = function (event) {
    var input = event.target.closest('[data-frg-field]');
    if (!input || this.readOnly || this.disabled) return;
    var tr = input.closest('[data-frg-row]');
    var row = tr && this.row(tr.dataset.frgRow);
    if (!row || row.saving) return;
    row.values[input.dataset.frgField] = input.value;
    row.dirty = !same(row.values, row.original);
    row.error = '';
    this.refreshRowStatus(row);
  };

  Grid.prototype.updateRow = function (key, patch) {
    var row = this.row(key);
    if (!row || this.readOnly || this.disabled || this.pending) return false;
    fields.forEach(function (name) {
      if (Object.prototype.hasOwnProperty.call(patch || {}, name)) {
        row.values[name] = name === 'signature_declared' ? patch[name] === true : String(patch[name] == null ? '' : patch[name]);
      }
    });
    row.dirty = !same(row.values, row.original);
    row.error = '';
    this.render();
    this.notifyDirty();
    return true;
  };

  Grid.prototype.handleClick = function (event) {
    var button = event.target.closest('[data-frg-action]');
    if (!button || button.disabled || this.pending || this.disabled) return;
    var tr = button.closest('[data-frg-row]');
    var row = tr && this.row(tr.dataset.frgRow);
    if (!row) return;
    var action = button.dataset.frgAction;
    var self = this;
    if (action === 'save' && !this.readOnly) this.save(row);
    if (action === 'delete' && !this.readOnly) this.remove(row);
    if (action === 'discard' && !this.readOnly) this.discard(row);
    if (action === 'documents' && this.options.onDocuments) this.options.onDocuments(clone(row.latest || row.base));
    if (action === 'review' && this.options.onReview) this.options.onReview(clone(row.latest || row.base));
    if (action === 'more' && this.options.onMore) {
      this.options.onMore(Object.assign({}, row.base || {}, this.payload(row)), {
        rowKey: row.key, rowNumber: this.rows.indexOf(row) + 1, readOnly: this.readOnly,
        update: function (patch) { return self.updateRow(row.key, patch); }
      });
    }
  };

  Grid.prototype.findSaved = function (result, payload, beforeIds) {
    if (result && result.savedPlayer && result.savedPlayer.id) return result.savedPlayer;
    if (result && result.player && result.player.id) return result.player;
    var all = result && Array.isArray(result.players) ? result.players : [];
    if (payload.id) return all.find(function (p) { return p.id === payload.id; });
    var normalize = function (s) { return String(s || '').replace(/[^a-z0-9]/gi, '').toUpperCase(); };
    return all.find(function (p) {
      return !beforeIds.has(p.id) &&
        normalize(p.document_number) === normalize(payload.document_number) &&
        p.document_type === payload.document_type && p.birth_date === payload.birth_date;
    });
  };

  Grid.prototype.save = async function (row) {
    if (this.pending || this.disabled || this.readOnly || !row.dirty || row.removed || !this.options.onSave) return;
    var tr = this.el.querySelector('[data-frg-row="' + row.key + '"]');
    var invalid = tr && Array.from(tr.querySelectorAll('input,select')).find(function (input) { return !input.checkValidity(); });
    if (invalid) { invalid.reportValidity(); invalid.focus(); return; }
    var payload = this.payload(row);
    if (!payload.full_name || !payload.document_number || !payload.birth_date) {
      row.error = 'Completa nombre, documento de identidad y fecha de nacimiento para guardar esta fila.';
      this.render();
      return;
    }
    var beforeIds = new Set(this.rows.filter(function (r) { return r.base; }).map(function (r) { return r.base.id; }));
    row.saving = true;
    row.error = '';
    this.notifyBusy(true);
    this.render();
    try {
      var result = await this.options.onSave(payload, row.base && row.base.updated_at ? row.base.updated_at : undefined);
      if (!result) { var cancelled = new Error('Operación cancelada.'); cancelled.cancelled = true; throw cancelled; }
      var saved = this.findSaved(result, payload, beforeIds);
      if (!saved) throw new Error('El servidor respondió, pero no pudimos identificar la fila guardada. Actualiza la nómina antes de volver a intentar.');
      row.base = clone(saved);
      row.latest = clone(saved);
      row.values = this.values(saved);
      row.original = clone(row.values);
      row.dirty = false;
      row.remoteChanged = false;
      row.removed = false;
      row.error = '';
      if (Array.isArray(result.players)) this.setData({ players: result.players, team: result.team || this.team });
      if (typeof this.options.onSnapshot === 'function') await this.options.onSnapshot(result.snapshot || result);
    } catch (error) {
      if (!error || error.cancelled !== true) {
        row.error = error && error.message ? error.message : 'No se pudo guardar esta fila. Tus datos siguen aquí para reintentar.';
        if (error && error.status === 409) row.error += ' Se conservaron los cambios de esta fila; revisa la versión actual antes de reintentar.';
        if (typeof this.options.onError === 'function') this.options.onError(row.error, error);
      }
    } finally {
      row.saving = false;
      this.notifyBusy(false);
      this.render();
      this.notifyDirty();
    }
  };

  Grid.prototype.remove = async function (row) {
    if (this.pending || this.disabled || this.readOnly || !row.base || !this.options.onDelete) return;
    if (!window.confirm('¿Quitar a ' + (row.values.full_name || 'este jugador') + ' de la nómina? Los documentos firmados afectados deberán actualizarse.')) return;
    row.saving = true;
    this.notifyBusy(true);
    this.render();
    try {
      var result = await this.options.onDelete(clone(row.latest || row.base));
      if (!result) { var cancelled = new Error('Operación cancelada.'); cancelled.cancelled = true; throw cancelled; }
      var index = this.rows.indexOf(row);
      if (index >= 0) this.rows[index] = this.newRow(null);
      if (Array.isArray(result.players)) this.setData({ players: result.players, team: result.team || this.team });
      if (typeof this.options.onSnapshot === 'function') await this.options.onSnapshot(result.snapshot || result);
    } catch (error) {
      if (!error || error.cancelled !== true) {
        row.error = error && error.message ? error.message : 'No se pudo retirar al jugador.';
        if (typeof this.options.onError === 'function') this.options.onError(row.error, error);
      }
    } finally {
      row.saving = false;
      this.notifyBusy(false);
      this.render();
      this.notifyDirty();
    }
  };

  Grid.prototype.discard = function (row) {
    if (!row.dirty || !window.confirm('¿Descartar los cambios sin guardar de esta fila? Las demás filas se conservarán.')) return;
    var latest = row.latest;
    var fresh = this.newRow(latest || null);
    fresh.key = row.key;
    this.rows[this.rows.indexOf(row)] = fresh;
    this.render();
    this.notifyDirty();
  };

  Grid.prototype.focusEmptyRow = function () {
    if (this.readOnly || this.disabled || this.pending) return false;
    var row = this.rows.find(function (r) { return !r.base && !r.dirty; }) ||
      this.rows.find(function (r) { return !r.base; });
    if (!row) return false;
    var input = this.el.querySelector('[data-frg-row="' + row.key + '"] [data-frg-field="full_name"]');
    if (input) { input.focus(); input.scrollIntoView({ block: 'nearest', inline: 'center' }); return true; }
    return false;
  };

  Grid.prototype.reset = function (render) {
    this.rows = [];
    this.lastDirtyCount = -1;
    if (render !== false) {
      while (this.rows.length < this.maxRows) this.rows.push(this.newRow(null));
      this.render();
      this.notifyDirty();
    }
  };
  Grid.prototype.destroy = function () {
    this.destroyed = true;
    this.el.removeEventListener('input', this.handleInput);
    this.el.removeEventListener('change', this.handleInput);
    this.el.removeEventListener('click', this.handleClick);
    this.rows = [];
    this.el.textContent = '';
    this.el.classList.remove('frg');
  };

  window.FufyRosterGrid = Object.freeze({
    create: function (container, options) { return new Grid(container, options); }
  });
})();
