(() => {
  'use strict';

  const ROUTE = window.location.pathname.replace(/\/+$/, '') || '/';
  const IS_COMPOSER = ROUTE === '/app' || ROUTE === '/app/new';
  const SIMPLE_SETTINGS = new Map([
    ['/app/settings/options', 'options'],
    ['/app/settings/language', 'language'],
    ['/app/settings/notifications', 'notifications'],
  ]);
  const OPTION_COMMANDS = new Map([
    ['é«˜ç²¾åº¦ç¿»è¨³', 'translation'],
    ['Agent Mode', 'agent-mode'],
    ['æ›¸é¡ä½œæˆ', 'document'],
    ['å¤–éƒ¨Storageè»¢é€', 'external-storage-transfer'],
  ]);

  let suppressComposerTrigger = false;
  let settingsRequestController = null;

  const text = (node) => (node?.textContent || '').replace(/\s+/g, ' ').trim();
  const create = (tag, className = '', value) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (value !== undefined) el.textContent = value;
    return el;
  };
  const button = (label, className = '') => {
    const el = create('button', className, label);
    el.type = 'button';
    return el;
  };

  function setNativeValue(input, value) {
    if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement || input instanceof HTMLSelectElement)) return;
    const proto = input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : input instanceof HTMlSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function triggerAllowedAt(textarea) {
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? start;
    if (start !== end) return false;
    if (start === 0) return true;
    return /\s/.test(textarea.value[start - 1] || '');
  }

  function bindComposerKeyboardTriggers() {
    if (!IS_COMPOSER) return;
    const textarea = document.querySelector('.canonical-composer-card textarea');
    if (!(textarea instanceof HTMLTextAreaElement) || textarea.dataset.canonTriggerBound === 'true') return;
    textarea.dataset.canonTriggerBound = 'true';
    textarea.addEventListener('keydown', (event) => {
      if (suppressComposerTrigger || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
      if ((event.key !== '@' && event.key !== '/') || !triggerAllowedAt(textarea)) return;
      const selector = event.key === '@' ? '.canon-at' : '.canon-plus';
      const trigger = document.querySelector(selector);
      if (!(trigger instanceof HTMLButtonElement) || trigger.disabled) return;
      event.preventDefault();
      suppressComposerTrigger = true;
      trigger.click();
      queueMicrotask(() => { suppressComposerTrigger = false; });
    });
  }

  function labelForOptionInput(input) {
    const label = input.closest('label');
    return text(label);
  }

  function selectedOptionInputs() {
    return Array.from(document.querySelectorAll('.canonical-option-grid input[type="checkbox"]:checked'))
      .filter((input) => input instanceof HTMLInputElement);
  }

  function fieldByLabel(labelText) {
    return Array.from(document.querySelectorAll('.canonical-option-section .canonical-field'))
      .find((row) => text(row).includes(labelText));
  }

  function commandProjection() {
    const commands = [];
    const purpose = document.querySelector('.canonical-purpose-grid input[type="radio"]:checked');
    if (purpose instanceof HTMLInputElement && purpose.value) commands.push(`/purpose ${purpose.value}`);

    selectedOptionInputs().forEach((input) => {
      const label = labelForOptionInput(input);
      const key = Array.from(OPTION_COMMANDS.entries()).find(([name]) => label.includes(name))?.[1];
      if (!key) return;
      if (key === 'agent-mode') {
        const mode = fieldByLabel('Agentå¼·åº¦')?.querySelector('select');
        commands.push(`/option agent-mode ${mode instanceof HTMLSelectElement && mode.value ? mode.value : 'medium'}`);
        return;
      }
      if (key === 'document') {
        const template = fieldByLabel('æ›¸é¡Template ID')?.querySelector('input');
        const id = template instanceof HTMLInputElement ? template.value.trim() : '';
        const source = template instanceof HTMLElement ? template.dataset.templateSource || '' : '';
        commands.push(`/option document${source ? ` ${source}` : ''}${id ? ` ${id}` : ''}`);
        return;
      }
      if (key === 'external-storage-transfer') {
        const destination = fieldByLabel('Storage Destination ID')?.querySelector('input');
        const id = destination instanceof HTMLInputElement ? destination.value.trim() : '';
        commands.push(`/option external-storage-transfer${id ? ` ${id}` : ''}`);
        return;
      }
      if (key === 'translation') {
        const target = fieldByLabel('ç¿»è¨³å…ˆè¨€èª')?.querySelector('input');
        const lang = target instanceof HTMLInputElement ? target.value.trim() : '';
        commands.push(`/option translation${lang ? ` ${lang}` : ''}`);
      }
    });
    return commands;
  }

  function refreshCommandProjection() {
    if (!IS_COMPOSER) return;
    const card = document.querySelector('.canonical-composer-card');
    if (!(card instanceof HTMLElement)) return;
    const commands = commandProjection();
    card.dataset.canonInternalCommands = JSON.stringify(commands);
    let hidden = card.querySelector('[data-canon-command-projection]');
    if (!(hidden instanceof HTMLInputElement)) {
      hidden = document.createElement('input');
      hidden.type = 'hidden';
      hidden.dataset.canonCommandProjection = 'true';
      hidden.setAttribute('aria-hidden', 'true');
      card.append(hidden);
    }
    hidden.value = JSON.stringify(commands);
  }

  function bindProjectionEvents() {
    if (!IS_COMPOSER || document.documentElement.dataset.canonProjectionBound === 'true') return;
    document.documentElement.dataset.canonProjectionBound = 'true';
    document.addEventListener('change', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.canonical-purpose-grid,.canonical-option-grid,.canonical-option-section,.canonical-two-column')) refreshCommandProjection();
    });
    document.addEventListener('input', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.canonical-option-section,.canonical-two-column')) refreshCommandProjection();
    });
  }

  async function fetchJson(url, options = {}) {
    settingsRequestController?.abort();
    settingsRequestController = new AbortController();
    const response = await fetch(url, {
      credentials: 'include',
      headers: { Accept: 'application/json', ...(options.headers || {}) },
      ...options,
      signal: settingsRequestController.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (response.status === 204) return {};
    return response.json();
  }

  function record(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function preferenceData(payload) {
    const root = record(payload);
    return record(root.preferences || root.data || root);
  }

  function settingRow(label, control, help = '') {
    const row = create('label', 'canon-inline-setting-row');
    const copy = create('span', 'canon-inline-setting-copy');
    copy.append(create('strong', '', label));
    if (help) copy.append(create('small', '', help));
    row.append(copy, control);
    return row;
  }

  function checkboxControl(checked = false, disabled = false) {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = Boolean(checked);
    input.disabled = Boolean(disabled);
    return input;
  }

  function selectControl(options, value = '') {
    const select = create('select', 'canon-inline-select');
    options.forEach(([optionValue, label]) => {
      const option = create('option', '', label);
      option.value = optionValue;
      select.append(option);
    });
    select.value = value || options[0]?.[0] || '';
    return select;
  }

  function inputControl(value = '', type = 'text') {
    const input = create('input', 'canon-inline-input');
    input.type = type;
    input.value = value ?? '';
    return input;
  }

  function statusHost() {
    const status = create('p', 'canon-inline-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    return status;
  }

  async function saveJson(endpoint, payload, status) {
    status.textContent = 'ä¿å­˜ä¸­â€¦';
    try {
      await fetchJson(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      status.textContent = 'ä¿å­˜æ•—ã¾ã—ãŸã€‚';
      return true;
    } catch (error) {
      if (error?.name === 'AbortError') return false;
      status.textContent = `ä¿å­˜ã§ãã¾ã›ã‚“ã§ã—ãŸã€‚${error instanceof Error ? ` (${error.message})` : ''}`;
      return false;
    }
  }

  function dedicatedLinks() {
    const nav = create('div', 'canon-inline-dedicated-links');
    [
      ['/app/settings/templates', 'å€‹åˆ¥Bmateç®¡ç†'],
      ['/app/settings/storage-destinations', 'å¤–éƒ¨Storageæ¥ç¶šï¼Œè»¢é€å…‹'],
      ['/app/settings/astera-storage', 'Astera Storage'],
    ].forEach(([href, label]) => {
      const link = create('a', 'canon-inline-link', label);
      link.href = href;
      nav.append(link);
    });
    return nav;
  }

  async function buildOptionsPane(body, status) {
    body.append(create('p', 'canon-inline-loading', 'ç¾åœ¨è¨­å®šã‚’å–å¾—ã§ãã¾ã™ã€¦ã€‡));
    let data = {};
    try {
      data = preferenceData(await fetchJson('/api/preferences'));
    } catch (error) {
      if (error?.name !== 'AbortError') status.textContent = `ç¾åœ¨è¨­å®šã‚’å–å¾—ã§ãã¾ã›ã‚“ã§ã—ãŸã€‚${error instanceof Error ? ` (${error.message})` : ''}`;
    }
    body.replaceChildren();
    const fields = {
      translation: checkboxControl(data.translation !== false),
      agent_mode: checkboxControl(data.agent_mode !== false),
      document: checkboxControl(data.document !== false),
      storage_transfer: checkboxControl(data.storage_transfer !== false),
    };
    body.append(
      settingRow('é«˜ç²¾åº¦ç¿»è¨³', fields.translation, 'ï¼‹ã®å€™è£œã¸è¡¨ç¤º'),
      settingRow('Agent Mode', fields.agent_mode, 'ï¼‹ã®å€™è£œã¸è¡¨ç¤º'),
      settingRow('f›¸é£ä½œæˆ', fields.document, 'ï¼‹ã®å€™è£œã¸è¡¨ç¤º'),
      settingRow('å¤–éƒ¨Storageâ‹¢é€å…‰', fields.storage_transfer, 'ï¼‹ã®å€™è£œã¸è¡¨ç¤º'),
    );
    const info = create('div', 'canon-inline-note');
    info.innerHTML = '<strong>Private Mode</strong><p>Composerã‚’é–‹ããŸã³æ—¢å®šON8.h.K˜TôdnŠŠŞZé®8şhÈ8ş8®8ûÈ¾8îZéşŠÄ÷F–öîX	Š9Î8¾8(.Y
¾8(8î8¾8)>8#Â÷âs°¢&öG’æVæB†–æfòÂFVF–6FVDÆ–æ·2‚’“°¢6öç7B6fRÒ'WGFöâ‚~KùŞZÙ‚rÂv6æöâÖ–æÆ–æR×&–Ö'’r“°¢6fRæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâfö–B6fT§6öâ‚rö’÷&VfW&Væ6W2rÂ°¢G&ç6ÆF–öã¢f–VÆG2çG&ç6ÆF–öâæ6†V6¶VBÀ¢vVçEöÖöFS¢f–VÆG2ævVçEöÖöFRæ6†V6¶VBÀ¢Fö7VÖVçC¢f–VÆG2æFö7VÖVçBæ6†V6¶VBÀ¢7F÷&vU÷G&ç6fW#¢f–VÆG2ç7F÷&vU÷G&ç6fW"æ6†V6¶VBÀ¢ÒÂ7FGW2’“°¢&öG’æVæB‡6fR“°¢Ğ ¢7–æ2gVæ7F–öâ'V–ÆDÆæwVvUæR†&öG’Â7FGW2’°¢&öG’æVæB†7&VFR‚wrÂv6æöâÖ–æÆ–æRÖÆöF–ærrÂ~xûîYÊŠŠŞZé®8).ŠªŞ8ş‹ëÎ8)>8~8N8î8(
br’“°¢ÆWBFFÒ·Ó°¢G'’°¢FFÒ&VfW&Væ6TFF†v—BfWF6„§6öâ‚rö’÷&VfW&Væ6W2r’“°¢Ò6F6‚†W'&÷"’°¢–b†W'&÷#òææÖRÓÒt&÷'DW'&÷"r’7FGW2çFW‡D6öçFVçBÒxûîYÊŠŠŞZé®8).Xùn[é~8~8Ş8î8¾8)>8~8~8ş8"G¶W'&÷"–ç7Fæ6VöbW'&÷"ò‚G¶W'&÷"æÖW76vWÒ–¢rwÖ°¢Ğ¢&öG’ç&WÆ6T6†–ÆG&Vâ‚“°¢6öç7BÆæwVvRÒ6VÆV7D6öçG&öÂ…µ²v¦Ô¥rÂ~iz^iÊÎŠ©âuÒÅ²vVâÕU2rÂtVævÆ—6‚uÕÒÂ7G&–ær†FFçV•öÆæwVvRÇÂFö7VÖVçBæFö7VÖVçDVÆVÖVçBæÆærÇÂv¦Ô¥r’“°¢6öç7BF†VÖRÒ6VÆV7D6öçG&öÂ…µ²w7—7FVÒrÂu7—7FVÒuÒÅ²vÆ–v‡BrÂtÆ–v‡BuÒÅ²vF&²rÂtF&²uÕÒÂ7G&–ær†FFçF†VÖRÇÂw7—7FVÒr’“°¢6öç7BWf–FVæ6RÒ6VÆV7D6öçG&öÂ…µ²w7FæF&BrÂ~j‰k©buÒÅ²v6ö×7BrÂ~{
kÙBuÒÅ²vW‡æFVBrÂ~Š›>{KuÕÒÂ7G&–ær†FFæWf–FVæ6UöF—7Æ•öÖöFRÇÂw7FæF&Br’“°¢6öç7BÖ÷F–öâÒ6†V6¶&÷„6öçG&öÂ„&ööÆVâ†FFç&VGV6VEöÖ÷F–öâ’“°¢&öG’æVæB€¢6WGF–æu&÷r‚~8+~8+88n8:ŠˆŠ©ârÂÆæwVvR’À¢6WGF–æu&÷r‚uF†VÖRrÂF†VÖR’À¢6WGF–æu&÷r‚~jhºŠzK®ik[ÈòrÂWf–FVæ6R’À¢6WGF–æu&÷r‚u&VGV6VBÖ÷F–öârÂÖ÷F–öâ’À¢“°¢6öç7B6fRÒ'WGFöâ‚~KùŞZÙ‚rÂv6æöâÖ–æÆ–æR×&–Ö'’r“°¢6fRæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâfö–B6fT§6öâ‚rö’÷&VfW&Væ6W2rÂ°¢V•öÆæwVvS¢ÆæwVvRçfÇVRÀ¢F†VÖS¢F†VÖRçfÇVRÀ¢Wf–FVæ6UöF—7Æ•öÖöFS¢Wf–FVæ6RçfÇVRÀ¢&VGV6VEöÖ÷F–öã¢Ö÷F–öâæ6†V6¶VBÀ¢ÒÂ7FGW2’“°¢&öG’æVæB‡6fR“°¢Ğ ¢7–æ2gVæ7F–öâ'V–ÆDæ÷F–f–6F–öç5æR†&öG’Â7FGW2’°¢&öG’æVæB†7&VFR‚wrÂv6æöâÖ–æÆ–æRÖÆöF–ærrÂ~xûîYÊŠŠŞZé®8).ŠªŞ8ş‹ëÎ8)>8~8N8î8(
br’“°¢ÆWBFFÒ·Ó°¢G'’°¢FFÒ&VfW&Væ6TFF†v—BfWF6„§6öâ‚rö’ö7&VF—Böæ÷F–f–6F–öâ×&VfW&Væ6W2r’“°¢Ò6F6‚†W'&÷"’°¢–b†W'&÷#òææÖRÓÒt&÷'DW'&÷"r’7FGW2çFW‡D6öçFVçBÒxûîYÊŠŠŞZé®8).Xùn[é~8~8Ş8î8¾8)>8~8~8ş8"G¶W'&÷"–ç7Fæ6VöbW'&÷"ò‚G¶W'&÷"æÖW76vWÒ–¢rwÖ°¢Ğ¢&öG’ç&WÆ6T6†–ÆG&Vâ‚“°¢6öç7B–äÒ6†V6¶&÷„6öçG&öÂ‡G'VRÂG'VR“°¢6öç7BVÖ–ÂÒ6†V6¶&÷„6öçG&öÂ„&ööÆVâ†FFæVÖ–ÅöVæ&ÆVB’“°¢6öç7BW6‚Ò6†V6¶&÷„6öçG&öÂ„&ööÆVâ†FFçW6…öVæ&ÆVB’“°¢6öç7BF‡&W6†öÆBÒ–çWD6öçG&öÂ…7G&–ær†FFæÆ÷uö7&VF—E÷F‡&W6†öÆBÇÂs#r’ÂvçVÖ&W"r“°¢F‡&W6†öÆBæÖ–âÒss°¢6öç7BV–WE7F'BÒ–çWD6öçG&öÂ…7G&–ær†FFçV–WEö†÷W'5÷7F'BÇÂs##£r’ÂwF–ÖRr“°¢6öç7BV–WDVæBÒ–çWD6öçG&öÂ…7G&–ær†FFçV–WEö†÷W'5öVæBÇÂsƒ£r’ÂwF–ÖRr“°¢&öG’æVæB€¢6WGF–æu&÷r‚tXh^ZèXZ˜	®yúRrÂ–äÂ~[ø^š‚r’À¢6WGF–æu&÷r‚tVÖ–Î˜	®yúRrÂVÖ–Â’À¢6WGF–æu&÷r‚uW6˜	®yúRrÂW6‚Â~zºşiÊµW&Ö—76–öî8Î[ø^Šhr’À¢6WGF–æu&÷r‚t7&VF—NŠÚnY®™kîX
BrÂF‡&W6†öÆB’À¢6WGF–æu&÷r‚uV–WB†÷W'>™h¾Zx²rÂV–WE7F'B’À¢6WGF–æu&÷r‚uV–WB†÷W'>{X.K¨brÂV–WDVæB’À¢“°¢6öç7BWfVçDæ÷FRÒ7&VFR‚vF—brÂv6æöâÖ–æÆ–æRÖæ÷FRr“°¢WfVçDæ÷FRæ–ææW$…DÔÂÒsÇ7G&öæsîZûî‹WfVçCÂ÷7G&öæsãÇäÆ÷rò7&—F–6Âò–ç7Vff–6–VçBòW&6†6RVæF–ærò7&VF—FVBò&W7VÖRf–Æ&ÆRò&W7VÖR&Æö6¶VN8.˜xŞŠh8®ZèXZ˜	®yú^8ôXh^˜	®yú^8).{jŞhÈ8~8î88#Â÷âs°¢&öG’æVæB†WfVçDæ÷FR“°¢6öç7B6fRÒ'WGFöâ‚~KùŞZÙ‚rÂv6æöâÖ–æÆ–æR×&–Ö'’r“°¢6fRæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâfö–B6fT§6öâ‚rö’ö7&VF—Böæ÷F–f–6F–öâ×&VfW&Væ6W2rÂ°¢–åööVæ&ÆVC¢G'VRÀ¢VÖ–ÅöVæ&ÆVC¢VÖ–Âæ6†V6¶VBÀ¢W6…öVæ&ÆVC¢W6‚æ6†V6¶VBÀ¢Æ÷uö7&VF—E÷F‡&W6†öÆC¢F‡&W6†öÆBçfÇVRÀ¢V–WEö†÷W'5÷7F'C¢V–WE7F'BçfÇVRÀ¢V–WEö†÷W'5öVæC¢V–WDVæBçfÇVRÀ¢ÒÂ7FGW2’“°¢&öG’æVæB‡6fR“°¢Ğ ¢7–æ2gVæ7F–öâ÷Vä–æÆ–æU6WGF–æw2‡æVÂÂ¶–æBÂF—FÆR’°¢–b‚‡æVÂ–ç7Fæ6Vöb…DÔÄVÆVÖVçB’’&WGW&ã°¢6WGF–æw5&WVW7D6öçG&öÆÆW#òæ&÷'B‚“°¢6öç7BæbÒæVÂçVW'•6VÆV7F÷"‚væbr“°¢6öç7B†VFW"ÒæVÂçVW'•6VÆV7F÷"‚v†VFW"r“°¢–b‚†æb–ç7Fæ6Vöb…DÔÄVÆVÖVçB’ÇÂ††VFW"–ç7Fæ6Vöb…DÔÄVÆVÖVçB’’&WGW&ã°¢æVÂçVW'•6VÆV7F÷"‚u¶FFÖ6æöâÖ–æÆ–æR×6WGF–æw5Òr“òç&VÖ÷fR‚“°¢æbæ†–FFVâÒG'VS°¢6öç7BæRÒ7&VFR‚w6V7F–öârÂv6æöâÖ–æÆ–æR×6WGF–æw2r“°¢æRæFF6WBæ6æöä–æÆ–æU6WGF–æw2Ò¶–æC°¢6öç7BæT†VFW"Ò7&VFR‚vF—brÂv6æöâÖ–æÆ–æR×6WGF–æw2Ö†VBr“°¢6öç7B&6²Ò'WGFöâ‚~(irÂv6æöâÖ–æÆ–æRÖ&6²r“°¢&6²ç6WDGG&–'WFR‚v&–ÖÆ&VÂrÂu6WGF–æw>KˆŠj~8h‹¾8(²r“°¢6öç7B†VF–ærÒ7&VFR‚vF—brÂrr“°¢†VF–æræVæB†7&VFR‚w7G&öærrÂrrÂF—FÆR’Â7&VFR‚w6ÖÆÂrÂrrÂu6WGF–æw2÷fW&Æ’r’“°¢æT†VFW"æVæB†&6²Â†VF–ær“°¢6öç7B&öG’Ò7&VFR‚vF—brÂv6æöâÖ–æÆ–æR×6WGF–æw2Ö&öG’r“°¢6öç7B7FGW2Ò7FGW4†÷7B‚“°¢æRæVæB‡æT†VFW"Â&öG’Â7FGW2“°¢†VFW"ægFW"‡æR“°¢&6²æFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ°¢6WGF–æw5&WVW7D6öçG&öÆÆW#òæ&÷'B‚“°¢æRç&VÖ÷fR‚“°¢æbæ†–FFVâÒfÇ6S°¢æbçVW'•6VÆV7F÷"‚vr“òæfö7W2‚“°¢Ò“°¢–b†¶–æBÓÓÒv÷F–öç2r’v—B'V–ÆD÷F–öç5æR†&öG’Â7FGW2“°¢VÇ6R–b†¶–æBÓÓÒvÆæwVvRr’v—B'V–ÆDÆæwVvUæR†&öG’Â7FGW2“°¢VÇ6R–b†¶–æBÓÓÒvæ÷F–f–6F–öç2r’v—B'V–ÆDæ÷F–f–6F–öç5æR†&öG’Â7FGW2“°¢Ğ ¢gVæ7F–öâVæ†æ6U6WGF–æw4÷fW&Æ’‚’°¢6öç7BæVÂÒFö7VÖVçBçVW'•6VÆV7F÷"‚ræW‡FW&–÷"×6WGF–æw2×æVÂr“°¢–b‚‡æVÂ–ç7Fæ6Vöb…DÔÄVÆVÖVçB’ÇÂæVÂæFF6WBæ6æöä÷fW&Æ”&÷VæF'’ÓÓÒwG'VRr’&WGW&ã°¢æVÂæFF6WBæ6æöä÷fW&Æ”&÷VæF'’ÒwG'VRs°¢æVÂçVW'•6VÆV7F÷'4fÆÂ‚væb¶‡&VeÒr“°¢æVÂçVW'•6VÆV7F÷$ÆÂ‚væb¶‡&VeÒr’æf÷$V6‚‚†Æ–æ²’Óâ°¢–b‚†Æ–æ²–ç7Fæ6Vöb…DÔÄæ6†÷$VÆVÖVçB’’&WGW&ã°¢6öç7B&t‡&VbÒÆ–æ²ævWDGG&–'WFR‚v‡&Vbr’ÇÂÆ–æ²æ‡&VbÇÂrs°¢6öç7BF†æÖRÒ&t‡&Vbç7F'G5v—F‚‚ròr¢ò&t‡&Vbç7Æ—B‚õ³ò5ÒòÂ•³Ğ¢¢‚‚’Óâ²G'’²&WGW&âæWrU$Â‡&t‡&VbÂv–æF÷ræÆö6F–öâæ‡&Vb’çF†æÖS²Ò6F6‚²&WGW&ârs²ÒÒ’‚“°¢6öç7B¶–æBÒ4”ÕÄUõ4UED”äu2ævWB‡F†æÖR“°¢–b†¶–æB’°¢Æ–æ²æFF6WBæ6æöå6WGF–æw4ÖöFRÒv÷fW&Æ’s°¢Æ–æ²æFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ†WfVçB’Óâ°¢WfVçBç&WfVçDFVfVÇB‚“°¢WfVçBç7F÷&÷vF–öâ‚“°¢fö–B÷Vä–æÆ–æU6WGF–æw2‡æVÂÂ¶–æBÂFW‡B†Æ–æ²’ç&WÆ6R‚~(¢rÂrr’çG&–Ò‚’“°¢Ò“°¢ÒVÇ6R°¢Æ–æ²æFF6WBæ6æöå6WGF–æw4ÖöFRÒwvRs°¢Ğ¢Ò“°¢Ğ ¢gVæ7F–öâ'Vâ‚’°¢&–æD6ö×÷6W$¶W–&ö&EG&–vvW'2‚“°¢&–æE&ö¦V7F–öäWfVçG2‚“°¢&Vg&W6„6öÖÖæE&ö¦V7F–öâ‚“°¢Væ†æ6U6WGF–æw4÷fW&Æ’‚“°¢Ğ ¢ÆWBVWVVBÒfÇ6S°¢6öç7B66†VGVÆRÒ‚’Óâ°¢–b‡VWVVB’&WGW&ã°¢VWVVBÒG'VS°¢&WVW7Dæ–ÖF–öäg&ÖR‚‚’Óâ°¢VWVVBÒfÇ6S°¢'Vâ‚“°¢Ò“°¢Ó° ¢–b†Fö7VÖVçBç&VG•7FFRÓÓÒvÆöF–ærr’Fö7VÖVçBæFDWfVçDÆ—7FVæW"‚tDôÔ6öçFVçDÆöFVBrÂ66†VGVÆRÂ²öæ6S¢G'VRÒ“°¢VÇ6R66†VGVÆR‚“°¢æWr×WFF–öäö'6W'fW"‡66†VGVÆR’æö'6W'fR†Fö7VÖVçBæFö7VÖVçDVÆVÖVçBÂ²6†–ÆDÆ—7C¢G'VRÂ7V'G&VS¢G'VRÒ“°§Ò’‚“°