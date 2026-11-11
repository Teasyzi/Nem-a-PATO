import { firebaseConfig } from './firebase-config.js';

const FIREBASE_VERSION = '11.10.0';
const FIREBASE_BASE = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
const questionBank = await fetch('./questions.json').then((response) => {
  if (!response.ok) throw new Error('Não foi possível carregar o banco de perguntas.');
  return response.json();
});

const root = document.querySelector('#app');
const codeChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const state = {
  roomCode: null,
  room: null,
  codeInput: new URLSearchParams(window.location.search).get('sala')?.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) ?? '',
  busy: false,
  connected: false,
  error: '',
  notice: '',
  auth: null,
  db: null,
  firestore: null,
  unsubscribeRoom: null,
};

const configValues = Object.values(firebaseConfig);
const firebaseConfigured = configValues.length === 6 && configValues.every((value) => typeof value === 'string' && value.trim().length > 0);

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  })[char]);
}

function createCode() {
  const values = new Uint32Array(6);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => codeChars[value % codeChars.length]).join('');
}

function getErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('ROOM_NOT_FOUND')) return 'Não encontramos uma sala com esse código. Confira e tente novamente.';
  if (message.includes('ROOM_FULL')) return 'Essa sala já está conectada a dois aparelhos.';
  if (message.includes('ROOM_CODE_TAKEN')) return 'O código foi gerado por outro aparelho. Tente criar a sala novamente.';
  if (message.includes('permission-denied')) return 'O Firebase bloqueou essa ação. Confira as regras do banco de dados.';
  if (message.includes('network-request-failed') || message.includes('unavailable')) return 'Sem conexão com o servidor. Verifique a internet e tente novamente.';
  if (message.includes('auth/operation-not-allowed')) return 'Ative o provedor de autenticação anônima no Firebase.';
  if (message.includes('FIREBASE_NOT_CONFIGURED')) return 'Preencha a configuração Web do Firebase em firebase-config.js.';
  return message || 'Não foi possível concluir. Tente novamente.';
}

function toastMarkup() {
  if (!state.error && !state.notice) return '';
  const isError = Boolean(state.error);
  return `<div class="toast ${isError ? 'error-toast' : 'notice-toast'}" role="status">
    ${isError ? '<span class="toast-icon">!</span>' : '<span class="toast-icon">✓</span>'}
    <span>${escapeHtml(state.error || state.notice)}</span>
    <button data-action="dismiss-toast" aria-label="Fechar aviso">×</button>
  </div>`;
}

function renderSetup() {
  root.innerHTML = `<div class="ambient ambient-one"></div><div class="ambient ambient-two"></div>
    <div class="page-wrap">
      <header class="topbar"><a class="brand" href="./"><span class="brand-duck">🦆</span><span>NEM A PATO<span class="brand-dot">!</span></span></a><div class="topbar-tag"><span class="pulse-dot"></span> JOGO COMPARTILHADO</div></header>
      <section class="setup-card">
        <div class="setup-icon">🔒</div><p class="eyebrow">CONFIGURAÇÃO INICIAL</p>
        <h1>Falta conectar o Firebase</h1>
        <p class="setup-copy">A interface e o banco com <strong>${questionBank.length.toLocaleString('pt-BR')} perguntas</strong> já estão prontos. Para que os dois aparelhos compartilhem a mesma pergunta pela internet, conecte um projeto Firebase gratuito.</p>
        <div class="setup-steps">
          <div><span>1</span><p>Crie um projeto no Firebase e adicione um aplicativo Web.</p></div>
          <div><span>2</span><p>Ative o login anônimo e crie o Firestore Database.</p></div>
          <div><span>3</span><p>Copie os dados de configuração para <code>firebase-config.js</code>.</p></div>
          <div><span>4</span><p>Publique as regras do banco usando o arquivo <code>firestore.rules</code>.</p></div>
        </div>
        <div class="setup-note"><span>ⓘ</span> Não coloque senhas ou chaves privadas aqui. A configuração Web do Firebase é pública por natureza; as regras do Firestore limitam as salas a dois participantes.</div>
      </section>
      ${toastMarkup()}
      <footer class="footer"><span>FEITO PARA JOGAR JUNTO</span><span>•</span><span>${questionBank.length.toLocaleString('pt-BR')} PERGUNTAS NO BANCO</span></footer>
    </div>`;
}

function renderLobby() {
  root.innerHTML = `<div class="ambient ambient-one"></div><div class="ambient ambient-two"></div>
    <div class="page-wrap">
      <header class="topbar"><a class="brand" href="./"><span class="brand-duck">🦆</span><span>NEM A PATO<span class="brand-dot">!</span></span></a><div class="topbar-tag"><span class="pulse-dot"></span> JOGO COMPARTILHADO</div></header>
      <section class="lobby-grid">
        <div class="intro-panel"><div class="duck-bubble">🦆</div><p class="eyebrow">UMA PERGUNTA. UM PALPITE. UMA REVELAÇÃO.</p>
          <h1>Será que você<br><span>acerta essa?</span></h1>
          <p class="intro-copy">Reúna a galera, chute um número e descubra quem chegou mais perto. A pergunta e a resposta aparecem iguais nos dois aparelhos.</p>
          <div class="feature-line"><span>▣ &nbsp;2 aparelhos</span><span>↻ &nbsp;Ao vivo</span><span>✦ &nbsp;${questionBank.length.toLocaleString('pt-BR')} perguntas</span></div>
        </div>
        <div class="join-card"><div class="card-heading"><span class="mini-icon">↗</span><div><h2>Vamos jogar?</h2><p>Crie uma sala ou entre com um código.</p></div></div>
          <button class="primary-button create-button" data-action="create-room" ${state.busy ? 'disabled' : ''}>${state.busy ? 'CRIANDO…' : '✦ &nbsp; CRIAR NOVA SALA'}</button>
          <div class="or-divider"><span></span><small>OU ENTRE EM UMA SALA</small><span></span></div>
          <form id="join-form"><label class="input-label" for="room-code">CÓDIGO DE 6 CARACTERES</label>
            <input id="room-code" class="code-input" value="${escapeHtml(state.codeInput)}" placeholder="EX: PATO23" maxlength="6" autocomplete="off" spellcheck="false" />
            <button class="secondary-button" type="submit" ${state.busy || state.codeInput.length !== 6 ? 'disabled' : ''}>ENTRAR NA SALA &nbsp; ↗</button>
          </form>
          <div class="privacy-line">🔒 &nbsp;Cada sala aceita até dois aparelhos.</div>
        </div>
      </section>
      ${toastMarkup()}
      <footer class="footer"><span>FEITO PARA JOGAR JUNTO</span><span>•</span><span>${questionBank.length.toLocaleString('pt-BR')} PERGUNTAS NO BANCO</span></footer>
    </div>`;
}

function currentQuestion() {
  if (!state.room?.currentQuestionId) return null;
  return questionBank.find((item) => item.id === state.room.currentQuestionId) ?? null;
}

function formatAnswer(value, unit) {
  const formatted = new Intl.NumberFormat('pt-BR', {
    maximumFractionDigits: 2,
    useGrouping: unit !== 'ano',
  }).format(value);
  return unit ? `${formatted} ${unit}` : formatted;
}

function renderRoom() {
  const question = currentQuestion();
  const room = state.room;
  const round = room?.round ?? 0;
  const players = room?.playerIds?.length ?? 1;
  const questionPanel = !question
    ? `<div class="empty-question"><div class="big-duck">🦆</div><p class="eyebrow">A SALA ESTÁ PRONTA</p><h1>Quem vai dar o<br><span>primeiro palpite?</span></h1><p>Aperte o botão para sortear a primeira pergunta.</p></div>`
    : `<div class="question-content"><p class="eyebrow">PERGUNTA ${round}</p><h1>${escapeHtml(question.question)}</h1>
      ${room.revealed
        ? `<div class="answer-reveal"><div class="answer-label">✓ &nbsp;RESPOSTA CORRETA</div><div class="answer-number">${escapeHtml(formatAnswer(question.answer, question.unit))}</div><p>${escapeHtml(question.explanation)}</p></div>`
        : '<div class="waiting-answer">◉ &nbsp;Façam seus palpites antes de revelar!</div>'}
      </div>`;
  const nextAction = !question || room?.revealed;
  root.innerHTML = `<div class="ambient ambient-one"></div><div class="ambient ambient-two"></div>
    <div class="page-wrap">
      <header class="topbar"><a class="brand" href="./" data-action="exit-room"><span class="brand-duck">🦆</span><span>NEM A PATO<span class="brand-dot">!</span></span></a><div class="topbar-tag"><span class="pulse-dot"></span> JOGO COMPARTILHADO</div></header>
      <section class="game-layout">
        <div class="room-bar"><button class="back-button" data-action="exit-room">← &nbsp;Sair</button>
          <div class="room-code-block"><span class="room-overline">CÓDIGO DA SALA</span><strong>${escapeHtml(state.roomCode)}</strong></div>
          <button class="icon-button" data-action="copy-code" aria-label="Copiar código">▣</button>
          <button class="share-button" data-action="share-room">↗ &nbsp;Convidar</button>
        </div>
        <div class="connection-row"><span class="connection-status ${state.connected ? 'online' : ''}"><span></span>${state.connected ? 'Sincronizado em tempo real' : 'Conectando...'}</span>
          <span class="players-count">▣ &nbsp;${players}/2 aparelhos</span>${round ? `<span class="round-count">RODADA ${round}</span>` : ''}</div>
        <div class="question-card ${room?.revealed ? 'answer-open' : ''}">
          <div class="question-card-top"><span class="category-chip">${escapeHtml(question?.category ?? 'ESTÁ NA HORA')}</span><span class="question-mark">?</span></div>
          ${questionPanel}
        </div>
        <div class="action-area"><button class="primary-button main-action ${!nextAction ? 'reveal-action' : ''}" data-action="${nextAction ? 'draw-next' : 'reveal-answer'}" ${state.busy || !state.connected ? 'disabled' : ''}>
          ${state.busy ? 'AGUARDE…' : nextAction ? (question ? '↻ &nbsp;SORTEAR PRÓXIMO TEMA' : '✦ &nbsp;SORTEAR TEMA') : '✦ &nbsp;REVELAR RESPOSTA'}
        </button><p class="sync-hint">↻ &nbsp;Ação sincronizada nos dois aparelhos</p></div>
        <div class="room-footnote">🦆 &nbsp;Não vale espiar antes da hora!</div>
      </section>
      ${toastMarkup()}
      <footer class="footer"><span>FEITO PARA JOGAR JUNTO</span><span>•</span><span>${questionBank.length.toLocaleString('pt-BR')} PERGUNTAS NO BANCO</span></footer>
    </div>`;
}

function render() {
  if (!firebaseConfigured) return renderSetup();
  if (!state.roomCode) return renderLobby();
  renderRoom();
}

async function loadFirebase() {
  const [appModule, authModule, firestoreModule] = await Promise.all([
    import(`${FIREBASE_BASE}/firebase-app.js`),
    import(`${FIREBASE_BASE}/firebase-auth.js`),
    import(`${FIREBASE_BASE}/firebase-firestore.js`),
  ]);
  const app = appModule.initializeApp(firebaseConfig);
  state.auth = authModule.getAuth(app);
  state.db = firestoreModule.getFirestore(app);
  state.firestore = { ...authModule, ...firestoreModule };
}

async function ensureUser() {
  if (!state.auth || !state.db || !state.firestore) throw new Error('FIREBASE_NOT_CONFIGURED');
  if (typeof state.auth.authStateReady === 'function') await state.auth.authStateReady();
  if (state.auth.currentUser) return state.auth.currentUser;
  const credential = await state.firestore.signInAnonymously(state.auth);
  return credential.user;
}

function watchRoom(code) {
  state.unsubscribeRoom?.();
  state.connected = false;
  const ref = state.firestore.doc(state.db, 'rooms', code);
  state.unsubscribeRoom = state.firestore.onSnapshot(ref, (snapshot) => {
    if (!snapshot.exists()) {
      state.room = null;
      state.roomCode = null;
      state.connected = false;
      state.error = 'Esta sala não existe mais. Crie outra ou entre com um novo código.';
      render();
      return;
    }
    state.room = snapshot.data();
    state.connected = true;
    state.error = '';
    render();
  }, (error) => {
    state.connected = false;
    state.error = getErrorMessage(error);
    render();
  });
}

async function createRoom() {
  state.busy = true;
  state.error = '';
  state.notice = '';
  render();
  try {
    const user = await ensureUser();
    let code = '';
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = createCode();
      const ref = state.firestore.doc(state.db, 'rooms', candidate);
      const created = await state.firestore.runTransaction(state.db, async (transaction) => {
        const existing = await transaction.get(ref);
        if (existing.exists()) return false;
        transaction.set(ref, {
          code: candidate,
          ownerId: user.uid,
          playerIds: [user.uid],
          currentQuestionId: null,
          revealed: false,
          usedQuestionIds: [],
          round: 0,
          lastActionMs: 0,
          status: 'waiting',
          createdAt: state.firestore.serverTimestamp(),
          updatedAt: state.firestore.serverTimestamp(),
        });
        return true;
      });
      if (created) { code = candidate; break; }
    }
    if (!code) throw new Error('ROOM_CODE_TAKEN');
    state.roomCode = code;
    watchRoom(code);
  } catch (error) {
    state.error = getErrorMessage(error);
  } finally {
    state.busy = false;
    render();
  }
}

async function joinRoom() {
  const code = state.codeInput.trim().toUpperCase();
  if (code.length !== 6) {
    state.error = 'Digite o código completo de 6 caracteres.';
    render();
    return;
  }
  state.busy = true;
  state.error = '';
  state.notice = '';
  render();
  try {
    const user = await ensureUser();
    const ref = state.firestore.doc(state.db, 'rooms', code);
    await state.firestore.runTransaction(state.db, async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists()) throw new Error('ROOM_NOT_FOUND');
      const data = snapshot.data();
      if (data.playerIds?.includes(user.uid)) return;
      if ((data.playerIds?.length ?? 0) >= 2) throw new Error('ROOM_FULL');
      transaction.update(ref, { playerIds: [...(data.playerIds ?? []), user.uid], updatedAt: state.firestore.serverTimestamp() });
    });
    state.roomCode = code;
    state.codeInput = '';
    watchRoom(code);
  } catch (error) {
    state.error = getErrorMessage(error);
  } finally {
    state.busy = false;
    render();
  }
}

async function drawNext() {
  if (!state.roomCode || !state.db) return;
  state.busy = true;
  state.error = '';
  state.notice = '';
  render();
  try {
    const user = await ensureUser();
    const ref = state.firestore.doc(state.db, 'rooms', state.roomCode);
    const result = await state.firestore.runTransaction(state.db, async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists()) throw new Error('ROOM_NOT_FOUND');
      const data = snapshot.data();
      if (!data.playerIds?.includes(user.uid)) throw new Error('Você não faz parte desta sala.');
      if (data.currentQuestionId && !data.revealed) return 'A resposta atual ainda precisa ser revelada.';
      if (Date.now() - (data.lastActionMs || 0) < 1200) return 'Aguarde um instante para sortear novamente.';
      const used = data.usedQuestionIds ?? [];
      let available = questionBank.filter((item) => !used.includes(item.id));
      const nextUsed = available.length === 0 ? [] : [...used];
      if (available.length === 0) available = questionBank;
      const selected = available[Math.floor(Math.random() * available.length)];
      nextUsed.push(selected.id);
      transaction.update(ref, {
        currentQuestionId: selected.id,
        revealed: false,
        usedQuestionIds: nextUsed,
        round: (data.round ?? 0) + 1,
        status: 'playing',
        lastActionMs: Date.now(),
        updatedAt: state.firestore.serverTimestamp(),
      });
      return 'ok';
    });
    if (result !== 'ok') state.notice = result;
  } catch (error) {
    state.error = getErrorMessage(error);
  } finally {
    state.busy = false;
    render();
  }
}

async function revealAnswer() {
  if (!state.roomCode || !state.db) return;
  state.busy = true;
  state.error = '';
  state.notice = '';
  render();
  try {
    const user = await ensureUser();
    const ref = state.firestore.doc(state.db, 'rooms', state.roomCode);
    await state.firestore.runTransaction(state.db, async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists()) throw new Error('ROOM_NOT_FOUND');
      const data = snapshot.data();
      if (!data.playerIds?.includes(user.uid)) throw new Error('Você não faz parte desta sala.');
      if (!data.currentQuestionId) throw new Error('Ainda não existe uma pergunta para revelar.');
      if (data.revealed) return;
      transaction.update(ref, { revealed: true, updatedAt: state.firestore.serverTimestamp() });
    });
  } catch (error) {
    state.error = getErrorMessage(error);
  } finally {
    state.busy = false;
    render();
  }
}

async function copyCode() {
  if (!state.roomCode) return;
  try {
    await navigator.clipboard.writeText(state.roomCode);
    state.notice = 'Código copiado! Envie para o outro aparelho.';
  } catch {
    state.notice = `Código da sala: ${state.roomCode}`;
  }
  render();
}

async function shareRoom() {
  if (!state.roomCode) return;
  const url = `${window.location.origin}${window.location.pathname}?sala=${state.roomCode}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Nem a Pato!', text: `Entre na minha sala usando o código ${state.roomCode}.`, url });
    } catch { /* fechamento do menu de compartilhamento não é um erro do jogo */ }
  } else {
    try {
      await navigator.clipboard.writeText(`${state.roomCode} — ${url}`);
      state.notice = 'Código e link copiados!';
    } catch {
      state.notice = `Código: ${state.roomCode}`;
    }
    render();
  }
}

function exitRoom() {
  state.unsubscribeRoom?.();
  state.unsubscribeRoom = null;
  state.roomCode = null;
  state.room = null;
  state.connected = false;
  state.error = '';
  state.notice = '';
  render();
}

root.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (button.tagName === 'A') event.preventDefault();
  if (action === 'create-room') void createRoom();
  if (action === 'copy-code') void copyCode();
  if (action === 'share-room') void shareRoom();
  if (action === 'draw-next') void drawNext();
  if (action === 'reveal-answer') void revealAnswer();
  if (action === 'exit-room') exitRoom();
  if (action === 'dismiss-toast') { state.error = ''; state.notice = ''; render(); }
});

root.addEventListener('input', (event) => {
  if (event.target.id !== 'room-code') return;
  state.codeInput = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  const submit = document.querySelector('#join-form button[type="submit"]');
  if (submit) submit.disabled = state.busy || state.codeInput.length !== 6;
});

root.addEventListener('submit', (event) => {
  if (event.target.id !== 'join-form') return;
  event.preventDefault();
  void joinRoom();
});

if (firebaseConfigured) {
  try {
    await loadFirebase();
  } catch (error) {
    state.error = getErrorMessage(error);
  }
}
render();
