/* Gigantes de Azapa · Mostrar/ocultar contraseñas en formularios existentes y futuros. */
(() => {
  'use strict';
  if (window.__gigantesPasswordVisibilityLoaded) return;
  window.__gigantesPasswordVisibilityLoaded = true;

  const STYLE_ID = 'gd-password-visibility-style';
  const SHOW_ICON = '<svg class="gd-pw-icon-show" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="2.7"/></svg>';
  const HIDE_ICON = '<svg class="gd-pw-icon-hide" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m3 3 18 18M10.6 10.6a2.1 2.1 0 0 0 2.8 2.8M9.8 5.7A11 11 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a14.5 14.5 0 0 1-3.1 3.7M6.3 6.9C3.6 8.6 2 12 2 12s3.6 6.5 10 6.5a11 11 0 0 0 4.5-1"/></svg>';

  function addStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.gd-pw-field{display:block;position:relative;width:100%;max-width:100%;min-width:0}',
      '.gd-pw-field>input.gd-pw-input{box-sizing:border-box;max-width:100%;padding-right:3.35rem!important}',
      '.gd-pw-field>button.gd-pw-toggle{appearance:none!important;position:absolute!important;top:50%!important;right:5px!important;transform:translateY(-50%)!important;z-index:2;display:inline-flex!important;align-items:center!important;justify-content:center!important;flex-direction:row!important;box-sizing:border-box!important;width:42px!important;min-width:42px!important;max-width:42px!important;height:42px!important;min-height:42px!important;max-height:42px!important;margin:0!important;padding:0!important;border:0!important;border-radius:9px!important;background:transparent!important;color:#475467!important;box-shadow:none!important;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent}',
      '.gd-pw-field>button.gd-pw-toggle:hover{background:rgba(15,23,42,.08)!important;color:#111827!important}',
      '.gd-pw-field>button.gd-pw-toggle:focus-visible{outline:3px solid #f59e0b!important;outline-offset:1px!important}',
      '.gd-pw-toggle svg{display:block;width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}',
      '.gd-pw-toggle .gd-pw-icon-hide{display:none}',
      '.gd-pw-toggle[aria-pressed="true"] .gd-pw-icon-show{display:none}',
      '.gd-pw-toggle[aria-pressed="true"] .gd-pw-icon-hide{display:block}',
      '@media(forced-colors:active){.gd-pw-field>button.gd-pw-toggle{color:ButtonText!important}}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(style);
  }

  function hasExistingEye(input) {
    const parent = input.parentElement;
    return !!(parent && parent.querySelector(
      'button.password-toggle,button.toggle-password,button[data-password-toggle],button[data-toggle-password]'
    ));
  }

  function addEye(input) {
    if (!(input instanceof HTMLInputElement) ||
        input.type !== 'password' ||
        input.dataset.gdPasswordVisibility === '1' ||
        !input.parentNode ||
        hasExistingEye(input)) return;

    const wrapper = document.createElement('span');
    wrapper.className = 'gd-pw-field';
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);
    input.classList.add('gd-pw-input');
    input.dataset.gdPasswordVisibility = '1';

    const button = document.createElement('button');
    button.type = 'button'; // Never submits a login, invitation or registration form.
    button.className = 'gd-pw-toggle';
    button.setAttribute('aria-label', 'Mostrar contraseña');
    button.setAttribute('aria-pressed', 'false');
    button.title = 'Mostrar contraseña';
    button.innerHTML = SHOW_ICON + HIDE_ICON;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const showing = input.type === 'password';
      let start = null, end = null;
      try { start = input.selectionStart; end = input.selectionEnd; } catch (_) {}
      input.type = showing ? 'text' : 'password';
      const action = showing ? 'Ocultar contraseña' : 'Mostrar contraseña';
      button.setAttribute('aria-label', action);
      button.setAttribute('aria-pressed', String(showing));
      button.title = action;
      try {
        input.focus({ preventScroll: true });
        if (start !== null && end !== null) input.setSelectionRange(start, end);
      } catch (_) { input.focus(); }
    });
    wrapper.appendChild(button);
  }

  function scan(root) {
    if (!(root instanceof Element)) return;
    if (root.matches('input[type="password"]')) addEye(root);
    root.querySelectorAll('input[type="password"]').forEach(addEye);
  }

  function start() {
    addStyle();
    scan(document.documentElement);
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) scan(node);
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();