// Production account and wallet previews are UI only: nothing is submitted or persisted.
const $ = id => document.getElementById(id);
const wallet = { trigger: $('store-open'), panel: $('wallet-popover') };
const account = { trigger: $('account-toggle'), panel: $('account-menu') };
const popovers = [wallet, account];
const accountDialog = $('account-dialog');
const storeDialog = $('store-dialog');
const ledgerDialog = $('ledger-dialog');

function closePopover({ trigger, panel }, restoreFocus = false) {
  if (panel.hidden) return;
  if (restoreFocus) trigger.focus({ preventScroll: true });
  panel.inert = true;
  panel.hidden = true;
  trigger.setAttribute('aria-expanded', 'false');
}

export function closeAccountMenu(restoreFocus = false) {
  closePopover(account, restoreFocus);
}

export function closeSidebarPopovers() {
  popovers.forEach(popover => closePopover(popover));
}

for (const { trigger, panel } of popovers) {
  trigger.addEventListener('click', () => {
    const opening = panel.hidden;
    closeSidebarPopovers();
    if (!opening) return;
    panel.hidden = false;
    panel.inert = false;
    trigger.setAttribute('aria-expanded', 'true');
    (panel.querySelector('input[type="radio"]:checked') ?? panel.querySelector('button')).focus({ preventScroll: true });
  });
}

function closeOutside({ target }) {
  for (const popover of popovers) {
    const { trigger, panel } = popover;
    if (!panel.hidden && !trigger.contains(target) && !panel.contains(target)) closePopover(popover);
  }
}

document.addEventListener('pointerdown', closeOutside);
document.addEventListener('focusin', closeOutside);
document.querySelector('.account-area').addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  const popover = popovers.find(({ panel }) => !panel.hidden);
  if (!popover) return;
  event.preventDefault();
  event.stopPropagation();
  closePopover(popover, true);
});

// Example catalog for the approved visual preview, never used as checkout or billing data.
const membershipPreview = [
  { id: 'standard', name: '标准会员', price: 29, points: 350 },
  { id: 'pro', name: 'Pro 会员', price: 59, points: 800 },
  { id: 'max', name: 'Max 会员', price: 99, points: 1500 },
];
const topupPreview = [
  { name: '100 积分', price: 10, points: 100 },
  { name: '300 积分', price: 30, points: 300 },
  { name: '600 积分', price: 60, points: 600 },
];
const formatNumber = new Intl.NumberFormat('zh-CN');
function element(tag, text = '', className = '') {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function renderStore(view) {
  const topup = view === 'topup';
  $('store-title').textContent = topup ? '积分充值预览' : '会员预览';
  $('store-topup').hidden = topup;
  $('store-back').hidden = !topup;
  storeDialog.dataset.view = view;

  const cards = (topup ? topupPreview : membershipPreview).map(({ id, name, price, points }) => {
    const card = element('article', '', topup ? 'store-card' : 'store-card reflective-plan');
    const title = element('h3', name);
    const pricing = element('p', '', 'store-price');
    pricing.append(element('strong', `¥${formatNumber.format(price)}`), element('span', topup ? ' / 次' : ' / 月'));
    const amount = element('p', `${topup ? '一次到账' : '每月赠送'} ${formatNumber.format(points)} 积分`);
    const action = element('button', '未开通', 'secondary');
    action.type = 'button';
    action.disabled = true;
    if (topup) card.append(title, pricing, amount, action);
    else {
      card.dataset.plan = id;
      const plate = element('div', '', 'reflective-plate');
      const terms = element('div', '', 'plan-terms');
      terms.append(pricing, amount);
      plate.append(title, terms, action);
      card.append(plate);
    }
    return card;
  });
  $('store-cards').replaceChildren(...cards);
}

function openStore(view = 'membership') {
  renderStore(view);
  if (!storeDialog.open) storeDialog.showModal();
  $('store-title').focus({ preventScroll: true });
  storeDialog.scrollTop = 0;
}

$('wallet-buy').addEventListener('click', () => { closePopover(wallet, true); openStore(); });
$('wallet-open-ledger').addEventListener('click', () => { closePopover(wallet, true); ledgerDialog.showModal(); });
$('login-entry').addEventListener('click', () => { closeAccountMenu(true); accountDialog.showModal(); });
$('wallet-ledger').addEventListener('click', () => ledgerDialog.showModal());
$('auth-topup').addEventListener('click', () => openStore('topup'));
$('store-topup').addEventListener('click', () => openStore('topup'));
$('store-back').addEventListener('click', () => openStore());

for (const dialog of [accountDialog, storeDialog, ledgerDialog]) {
  dialog.querySelector('.close-btn').addEventListener('click', () => dialog.close());
}
