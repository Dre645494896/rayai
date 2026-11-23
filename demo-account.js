// Same-origin simulator API and the original account-menu integration.
import { mountReflectiveCard } from './demo-reflective.js';
const $ = id => document.getElementById(id);
let disposeCards = [];
const number = new Intl.NumberFormat('zh-CN');
const compactNumber = new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 });
const date = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
const reasons = { grant: '注册赠送', charge: '生成扣除', refund: '失败退回', membership: '模拟会员赠送', topup: '模拟积分充值' };
let storeView = 'membership', catalog, storeLoading = false, purchaseBusy = false, resumeStore = false;
let retryPurchase, resumeLedger = false;
export let user = null;
export let balance = null;
let authBusy = false, accountVersion = 0;

export async function demoApi(path, data, signal) {
  const options = { credentials: 'same-origin', mode: 'same-origin', cache: 'no-store', redirect: 'error', signal };
  if (data !== undefined) Object.assign(options, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  let response;
  try { response = await fetch(`/demo-api/${path}`, options); }
  catch { throw Error('无法连接本地演示服务，请确认服务正在运行。'); }
  let result;
  try { result = await response.json(); } catch { /* Report the invalid response below. */ }
  if (!response.ok || !result || typeof result !== 'object') {
    throw Object.assign(Error(result?.error || '本地演示服务返回了无效响应。'), { status: response.status });
  }
  return result;
}

function message(id, text = '', error = false) {
  const node = $(id);
  node.hidden = !text;
  node.textContent = text;
  node.dataset.error = String(error);
}
function element(tag, text) {
  const node = document.createElement(tag);
  node.textContent = text || '';
  return node;
}
export function setBalance(value) {
  balance = user && Number.isFinite(value) ? value : null;
  const label = balance == null ? (user ? '余额暂不可用' : '登录后查看') : `${number.format(balance)} 积分`;
  $('store-balance').parentElement.hidden = !user;
  for (const id of ['balance', 'popover-balance', 'store-balance']) {
    if ($(id).textContent !== label) $(id).textContent = label;
  }
  const compact = $('balance');
  if (balance != null) compact.dataset.compact = compactNumber.format(balance);
  else delete compact.dataset.compact;
  $('ledger-balance').textContent = balance == null ? '—' : number.format(balance);
  const walletLabel = balance == null ? `积分钱包 · ${label}` : `积分钱包 · 余额 ${label}`;
  $('store-open').ariaLabel = walletLabel;
  $('store-open').title = walletLabel;
  document.dispatchEvent(new Event('demo-balance'));
}
export function applySession(session) {
  ++accountVersion;
  user = session.user || null;
  $('login-entry').textContent = user ? '演示账号' : '登录注册';
  $('account-toggle').title = user?.email || '';
  $('failure-next').checked = false;
  $('ledger-list').replaceChildren();
  if ($('ledger-dialog').open) $('ledger-dialog').close();
  setBalance(session.balance);
  document.dispatchEvent(new Event('demo-session'));
}
export function sessionExpired() {
  applySession({ user: null });
  openAccount();
  message('account-message', '登录已过期，请重新登录。', true);
}
export function openAccount() {
  $('auth-panel').hidden = Boolean(user);
  $('signed-panel').hidden = !user;
  if (user) {
    $('account-title').textContent = '演示账号';
    $('account-email').textContent = user.email;
  } else {
    $('account-title').textContent = '登录/注册';
    if (!$('account-dialog').open) $('password').value = '';
  }
  message('account-message');
  if (!$('account-dialog').open) $('account-dialog').showModal();
  (user ? $('logout') : $('email')).focus();
}
function setAuthBusy(value) {
  authBusy = value;
  for (const id of ['email', 'password', 'auth-submit', 'logout']) $(id).disabled = value;
}
async function authenticate(event) {
  event.preventDefault();
  if (authBusy) return;
  const input = { email: $('email').value.trim(), password: $('password').value };
  setAuthBusy(true);
  message('account-message');
  try {
    applySession(await demoApi('auth', input));
    $('auth-form').reset();
    $('account-dialog').close();
  } catch (error) { message('account-message', error.message, true); }
  finally { setAuthBusy(false); }
}
async function logout() {
  if (authBusy) return;
  setAuthBusy(true);
  message('account-message');
  try {
    await demoApi('logout', {});
    applySession({ user: null });
    $('account-dialog').close();
  } catch (error) { message('account-message', error.message, true); }
  finally { setAuthBusy(false); }
}
export async function refreshLedger() {
  if (!user) return;
  const version = accountVersion;
  try {
    const { balance: value, entries } = await demoApi('ledger');
    if (accountVersion !== version) return;
    setBalance(value);
    if (!$('ledger-dialog').open) return;
    const groups = new Map();
    for (const entry of entries) {
      const pair = entry.requestId && ['charge', 'refund'].includes(entry.reason);
      const key = pair ? `job:${entry.requestId}` : `entry:${entry.id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    }
    const signed = delta => `${delta > 0 ? '+' : ''}${number.format(delta)} 积分`;
    $('ledger-list').replaceChildren(...[...groups.values()].map(group => {
      const [latest] = group;
      const refunded = group.some(entry => entry.reason === 'refund');
      const delta = group.reduce((sum, entry) => sum + entry.delta, 0);
      const row = element('li');
      const detail = element('div');
      detail.append(element('strong', refunded ? '生成失败 · 已退回' : reasons[latest.reason] || latest.reason), element('small', date.format(new Date(latest.createdAt))));
      if (latest.requestId) {
        const receipt = element('details');
        receipt.append(element('summary', '交易详情'));
        for (const entry of [...group].reverse()) receipt.append(element('small', `${reasons[entry.reason]} ${signed(entry.delta)} · ${date.format(new Date(entry.createdAt))}`));
        receipt.append(element('small', `请求：${latest.requestId}`));
        detail.append(receipt);
      }
      const amount = element('strong', refunded && delta===0 ? '净扣 0 积分' : signed(delta));
      amount.className = `ledger-amount${delta > 0 ? ' positive' : ''}`;
      row.append(detail, amount);
      return row;
    }));
    message('ledger-note', entries.length ? '' : '暂无积分记录。');
  } catch (error) {
    if (accountVersion !== version) return;
    if (error.status === 401) return sessionExpired();
    message('ledger-note', error.message, true);
  }
}
function openLedger(fromWallet = false) {
  if (!user) {
    if (fromWallet) resumeLedger = true;
    else {
      resumeStore = true;
      $('store-dialog').close();
    }
    return openAccount();
  }
  $('ledger-list').replaceChildren();
  message('ledger-note', '正在读取积分账本…');
  $('ledger-dialog').showModal();
  refreshLedger();
}
function renderStore() {
  const topup = storeView === 'topup';
  $('store-title').textContent = topup ? '充值积分' : '购买会员';
  $('store-topup').hidden = topup;
  $('store-back').hidden = !topup;
  $('store-dialog').dataset.view = storeView;
  disposeCards.forEach(dispose => dispose());
  disposeCards = [];
  const items = (topup ? catalog?.packs : catalog?.plans) || [];
  $('store-cards').replaceChildren(...items.map(item => {
    const card = element('article');
    card.className = topup ? 'store-card' : 'store-card reflective-plan';
    card.dataset.plan = item.id;
    const price = element('p');
    price.className = 'store-price';
    price.append(element('strong', `¥${number.format(item.price)}`), element('span', topup ? ' / 次' : ' / 月'));
    const action = element('button', topup ? '模拟充值' : '模拟开通');
    action.className = 'secondary';
    action.type = 'button';
    action.dataset.kind = storeView;
    action.dataset.id = item.id;
    action.disabled = purchaseBusy;
    const content = topup ? card : element('div');
    const amount = element('p', `${topup ? '一次到账' : '每月赠送'} ${number.format(item.points)} 积分`);
    if (topup) content.append(element('h3', item.name), price, amount, action);
    else {
      content.className = 'reflective-plate';
      const title = element('h3', item.name);
      const terms = element('div');
      terms.className = 'plan-terms';
      terms.append(price, amount);
      content.append(title, terms, action);
      card.append(content);
      disposeCards.push(mountReflectiveCard(card, content));
    }
    return card;
  }));
}
async function openStore({ reset = true } = {}) {
  if (reset) storeView = 'membership';
  renderStore();
  message('store-message');
  if (!$('store-dialog').open) $('store-dialog').showModal();
  $('store-title').focus();
  if (catalog || storeLoading) return;
  storeLoading = true;
  message('store-message', '正在读取演示套餐…');
  try { catalog = await demoApi('store'); if ($('store-dialog').open) renderStore(); message('store-message'); }
  catch (error) { message('store-message', `${error.message} 请关闭后重试。`, true); }
  finally { storeLoading = false; }
}
function changeStore(view) {
  storeView = view;
  renderStore();
  if (catalog) message('store-message');
  $('store-title').focus();
}
async function buy(button) {
  if (purchaseBusy) return;
  if (!user) {
    resumeStore = true;
    $('store-dialog').close();
    openAccount();
    return;
  }
  const {kind, id} = button.dataset;
  const version = accountVersion;
  const key = `${version}:${kind}:${id}`;
  const requestId = retryPurchase?.key === key ? retryPurchase.requestId : crypto.randomUUID();
  retryPurchase = { key, requestId };
  purchaseBusy = true;
  for (const action of $('store-cards').querySelectorAll('button')) action.disabled = true;
  message('store-message', '处理中');
  try {
    const result = await demoApi('store/purchase', {kind, id, requestId});
    if (version !== accountVersion) return;
    retryPurchase = null;
    setBalance(result.balance);
    if ($('ledger-dialog').open) refreshLedger();
    message('store-message', `模拟到账 +${number.format(result.points)} 积分`);
  } catch (error) {
    if (version !== accountVersion) return;
    if (error.status === 401) {
      resumeStore = true;
      $('store-dialog').close();
      sessionExpired();
      return;
    }
    if (error.status && error.status >= 400 && error.status < 500) retryPurchase = null;
    message('store-message', error.message, true);
  } finally {
    purchaseBusy = false;
    for (const action of $('store-cards').querySelectorAll('button')) action.disabled = false;
  }
}
const sidebarPopovers = [
  { trigger: $('store-open'), panel: $('wallet-popover') },
  { trigger: $('account-toggle'), panel: $('account-menu') },
];
const popoverContains = ({trigger,panel}, node) => trigger.contains(node) || panel.contains(node);
function closePopover({trigger,panel}, restoreFocus = false) {
  if (panel.hidden) return;
  panel.hidden = true;
  trigger.setAttribute('aria-expanded', 'false');
  if (restoreFocus) trigger.focus({preventScroll:true});
}
export function closeAccountMenu(restoreFocus = false) { closePopover(sidebarPopovers[1], restoreFocus); }
export function closeSidebarPopovers() { sidebarPopovers.forEach(popover => closePopover(popover)); }
for (const popover of sidebarPopovers) {
  const {trigger,panel} = popover;
  trigger.onclick = () => {
    const opening = panel.hidden;
    closeSidebarPopovers();
    if (!opening) return;
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    panel.querySelector('button').focus({preventScroll:true});
  };
}
document.addEventListener('pointerdown', event => {
  for (const popover of sidebarPopovers) {
    if (!popover.panel.hidden && !popoverContains(popover, event.target)) closePopover(popover);
  }
});
document.addEventListener('focusin', event => {
  for (const popover of sidebarPopovers) {
    if (!popover.panel.hidden && !popoverContains(popover, event.target)) closePopover(popover);
  }
});
document.querySelector('.account-area').addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  const popover = sidebarPopovers.find(item => !item.panel.hidden);
  if (!popover) return;
  event.preventDefault();
  event.stopPropagation();
  closePopover(popover, true);
});
$('wallet-buy').onclick = () => { closePopover(sidebarPopovers[0], true); openStore(); };
$('wallet-open-ledger').onclick = () => { closePopover(sidebarPopovers[0], true); openLedger(true); };
$('store-dialog').addEventListener('close', () => {
  if ($('store-dialog').open) return;
  disposeCards.forEach(dispose => dispose());
  disposeCards = [];
});
$('auth-topup').onclick = () => {
  if (authBusy) return;
  resumeStore = true;
  storeView = 'topup';
  $('account-dialog').close();
};
$('wallet-ledger').onclick = () => openLedger();
$('store-topup').onclick = () => changeStore('topup');
$('store-back').onclick = () => changeStore('membership');
$('store-cards').onclick = event => {
  const button = event.target.closest('button[data-kind][data-id]');
  if (button) buy(button);
};
$('auth-form').onsubmit = authenticate;
$('logout').onclick = logout;
for (const button of document.querySelectorAll('[data-close]')) button.onclick = () => $(button.dataset.close).close();
$('account-dialog').addEventListener('close', () => {
  $('password').value = '';
  const returnToLedger = resumeLedger;
  resumeLedger = false;
  if (resumeStore) {
    resumeStore = false;
    openStore({ reset: false });
  } else if (returnToLedger && user) openLedger(true);
});
