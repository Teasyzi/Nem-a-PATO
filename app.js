import { firebaseConfig } from './firebase-config.js';

const FIREBASE_VERSION = '11.10.0';
const FIREBASE_BASE = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
const response = await fetch('./questions.json');
if (!response.ok) throw new Error('Não foi possível carregar o banco de perguntas.');
const questionBank = await response.json();
const root = document.querySelector('#app');
const codeChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const state = {
  view: 'home',
  roomCode: null,
  room: null,
  currentUser: null,
  codeInput: new URLSearchParams(location.search).get('sala')?.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) ?? '',
  busy: false,
  connected: false,
  error: '',
  notice: '',
  auth: null,
  db: null,
  firestore: null,
  unsubscribeRoom: null,
  unsubscribeMessages: null,
  messages: [],
  chatDraft: '',
  localRoom: null,
};

const firebaseConfigReady = Object.values(firebaseConfig).length >= 6
  && Object.values(firebaseConfig).every((value) => typeof value === 'string' && value.trim());

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  })[char]);
}

function createCode() {
  const bytes = new Uint32Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((value) => codeChars[value % codeChars.length]).join('');
}

function cleanName(value, fallback = 'Jogador') {
  const name = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 24);
  return name || fallback;
}

function toastMarkup() {
  if (!state.error && !state.notice) return '';
  const isError = Boolean(state.error);
  return `<div class="toast ${isError ? 'error-toast' : 'notice-toast'}" role="status">
    <span class="toast-icon">${isError ? '!' : '✓'}</span><span>${escapeHtml(state.error || state.notice)}</span>
    <button data-action="dismiss-toast" aria-label="Fechar aviso">×</button></div>`;
}

function footerMarkup() {
  return `<footer class="footer"><span>NEM A PATO! • ESTIME, BLEFE, DESAFIE</span><span>•</span><span>${questionBank.length.toLocaleString('pt-BR')} PERGUNTAS</span></footer>`;
}

function renderHome() {
  state.view = 'home';
  root.innerHTML = `<div class="ambient ambient-one"></div><div class="ambient ambient-two"></div>
    <div class="page-wrap">
      <header class="topbar"><a class="brand" href="./"><span class="brand-duck">🦆</span><span>NEM A PATO<span class="brand-dot">!</span></span></a><div class="topbar-tag"><span class="pulse-dot"></span> JOGO DE ESTIMATIVA E BLEFE</div></header>
      <section class="home-intro"><div class="duck-bubble">🦆</div><p class="eyebrow">NÃO PRECISA SABER. PRECISA TER CORAGEM.</p>
        <h1>Chute um número.<br><span>Ou desafie!</span></h1>
        <p class="intro-copy">Uma pergunta, palpites cada vez maiores e uma decisão: acreditar ou gritar “NEM A PATO!”? Se o palpite passou da resposta, quem chutou leva o pato; se ficou abaixo ou empatou, quem desafiou leva.</p>
      </section>
      <section class="mode-grid">
        <article class="mode-card presencial-card">
          <div class="mode-icon">👥</div><p class="eyebrow">TODO MUNDO JUNTO</p><h2>Modo presencial</h2>
          <p>Um aparelho para o grupo inteiro. Conversem em voz alta, façam seus palpites e desafiem sem precisar de chat ou internet.</p>
          <form id="local-start-form">
            <label class="input-label" for="local-player-names">NOMES DOS JOGADORES (2 A 10)</label>
            <textarea id="local-player-names" class="player-names-input" rows="3" placeholder="Ex.: Ana, Bruno, Carlos, Dani" required></textarea>
            <button class="primary-button" type="submit">JOGAR PRESENCIALMENTE ↗</button>
          </form>
        </article>
        <article class="mode-card online-card">
          <div class="mode-icon">💬</div><p class="eyebrow">CADA UM NO SEU APARELHO</p><h2>Modo online com chat</h2>
          <p>Crie uma sala, convide outra pessoa pelo código e discutam os palpites no chat integrado. Tudo sincronizado.</p>
          <form id="online-create-form">
            <label class="input-label" for="create-player-name">SEU NOME</label>
            <input id="create-player-name" class="text-input" maxlength="24" placeholder="Como quer aparecer?" required />
            <button class="primary-button" type="submit" ${state.busy ? 'disabled' : ''}>${state.busy ? 'CRIANDO…' : 'CRIAR SALA ONLINE ↗'}</button>
          </form>
          <div class="or-divider"><span></span><small>OU ENTRE EM UMA SALA</small><span></span></div>
          <form id="online-join-form">
            <label class="input-label" for="join-player-name">SEU NOME</label>
            <input id="join-player-name" class="text-input" maxlength="24" placeholder="Como quer aparecer?" required />
            <label class="input-label code-label" for="room-code">CÓDIGO DA SALA</label>
            <input id="room-code" class="code-input" value="${escapeHtml(state.codeInput)}" placeholder="ABC123" maxlength="6" autocomplete="off" spellcheck="false" />
            <button class="secondary-button" type="submit" ${state.busy || state.codeInput.length !== 6 ? 'disabled' : ''}>ENTRAR NA SALA</button>
          </form>
          <div class="privacy-line">🔒 &nbsp;Sala online para 2 aparelhos, com chat particular.</div>
        </article>
      </section>
      ${!firebaseConfigReady ? '<div class="setup-note">O modo presencial funciona sem Firebase. Para salas online, preencha firebase-config.js.</div>' : ''}
      ${toastMarkup()}${footerMarkup()}
    </div>`;
}

function formatNumber(value) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(Number(value));
}

function answerText(question) {
  if (!question) return '';
  return `${formatNumber(question.answer)}${question.unit ? ` ${question.unit}` : ''}`;
}

function findQuestion(id) {
  return questionBank.find((item) => item.id === id) ?? null;
}

function onlinePlayers(room) {
  return (room.playerIds || []).map((uid) => ({
    uid,
    name: room.playerNames?.[uid] || `Jogador ${(room.playerIds || []).indexOf(uid) + 1}`,
    cards: Number(room.cardsByPlayer?.[uid] || 0),
  }));
}

function renderPlayerScores(players, activeId, loserId = null) {
  return `<div class="players-board">${players.map((player, index) => `<div class="player-chip ${player.uid === activeId ? 'is-turn' : ''} ${player.uid === loserId ? 'has-pato' : ''}">
    <span class="player-avatar">${escapeHtml(player.name.slice(0, 1).toUpperCase())}</span>
    <span class="player-details"><strong>${escapeHtml(player.name)}</strong><small>${player.uid === activeId ? 'É sua vez' : 'Na partida'}</small></span>
    <span class="duck-score">🦆 ${player.cards}</span>
  </div>`).join('')}</div>`;
}

function renderQuestionCard(question, room, online = false) {
  const round = room.round || 0;
  if (!question) return `<div class="question-card"><div class="empty-question"><div class="big-duck">🦆</div><p class="eyebrow">${online && (room.playerIds || []).length < 2 ? 'AGUARDANDO O OUTRO JOGADOR' : 'A SALA ESTÁ PRONTA'}</p>
    <h2>${online && (room.playerIds || []).length < 2 ? 'Convide alguém para entrar' : 'Quem vai dar o primeiro palpite?'}</h2>
    <p>${online && (room.playerIds || []).length < 2 ? 'Compartilhe o código da sala. A partida começa quando o segundo aparelho entrar.' : 'Sorteie uma pergunta para começar a rodada.'}</p></div></div>`;

  const lastGuess = room.lastGuess;
  const lastGuessName = online
    ? (room.playerNames?.[room.lastGuessByUid] || 'Jogador')
    : (room.players?.[room.lastGuessByIndex]?.name || 'Jogador');
  const lastGuessLine = lastGuess !== null && lastGuess !== undefined
    ? `<div class="last-guess"><span>ÚLTIMO PALPITE</span><strong>${formatNumber(lastGuess)}${question.unit ? ` ${escapeHtml(question.unit)}` : ''}</strong><small>por ${escapeHtml(lastGuessName)}</small></div>` : '';
  const answer = room.revealed ? `<div class="answer-reveal"><div class="answer-label">✓ &nbsp;RESPOSTA DE REFERÊNCIA</div><div class="answer-number">${escapeHtml(answerText(question))}</div><p>${escapeHtml(question.explanation || '')}</p>${question.sourceUrl ? `<a class="source-link" href="${escapeHtml(question.sourceUrl)}" target="_blank" rel="noreferrer">Consultar referência ↗</a>` : ''}</div>` : '';
  const loserName = online
    ? (room.playerNames?.[room.roundLoserUid] || 'Um jogador')
    : (room.players?.[room.roundLoserIndex]?.name || 'Um jogador');
  const hasLoser = online ? Boolean(room.roundLoserUid) : room.roundLoserIndex !== null && room.roundLoserIndex !== undefined;
  const verdict = room.revealed && hasLoser
    ? `<div class="round-verdict">🦆 <strong>${escapeHtml(loserName)}</strong> recebe um pato nesta rodada.</div>`
    : '';
  return `<div class="question-card ${room.revealed ? 'answer-open' : ''}">
    <div class="question-card-top"><span class="category-chip">${escapeHtml(question.category || 'ESTIMATIVA')}</span><span class="question-round">RODADA ${round}</span></div>
    <div class="question-content"><p class="eyebrow">FAÇAM SUAS ESTIMATIVAS</p><h2>${escapeHtml(question.question)}</h2>
      ${lastGuessLine}${answer}${verdict}
    </div></div>`;
}

function activeTurnName(room, online) {
  if (online) return room.playerNames?.[room.turnUid] || 'outro jogador';
  return room.players?.[room.turnIndex]?.name || 'próximo jogador';
}

function renderActionArea(room, online, uid, question) {
  const playersReady = online ? (room.playerIds || []).length === 2 : (room.players || []).length >= 2;
  if (!playersReady) return '<div class="action-area"><p class="sync-hint">A partida começa quando os dois aparelhos estiverem conectados.</p></div>';
  if (!question || room.revealed) {
    const canStart = !online || room.starterUid === uid;
    return `<div class="action-area"><button class="primary-button main-action" data-action="${online ? 'online-next' : 'local-next'}" ${state.busy || !canStart ? 'disabled' : ''}>${room.revealed ? 'PRÓXIMA PERGUNTA ↻' : 'SORTEAR PRIMEIRA PERGUNTA ✦'}</button>
      <p class="sync-hint">${canStart ? 'Quem desafiou começa a próxima rodada.' : `Aguardando ${escapeHtml(activeTurnName(room, online))} iniciar a próxima rodada.`}</p></div>`;
  }
  const isMyTurn = online ? room.turnUid === uid : true;
  if (!isMyTurn) return `<div class="action-area turn-wait"><div class="turn-message">⏳ Vez de <strong>${escapeHtml(activeTurnName(room, online))}</strong></div><p class="sync-hint">${online ? 'O próximo palpite ou desafio aparecerá aqui automaticamente.' : 'Passe o aparelho para o próximo jogador.'}</p></div>`;
  const canChallenge = room.lastGuess !== null && room.lastGuess !== undefined;
  const inputHint = canChallenge ? `Maior que ${formatNumber(room.lastGuess)}` : 'Digite seu primeiro palpite';
  return `<div class="action-area guess-area">
    <form class="guess-form" id="guess-form"><label class="input-label" for="guess-value">${canChallenge ? 'AUMENTE O PALPITE' : 'DÊ O PRIMEIRO PALPITE'}</label>
      <div class="guess-entry"><input id="guess-value" class="guess-input" type="number" step="1" inputmode="numeric" placeholder="${inputHint}" required /><button class="primary-button guess-submit" type="submit" ${state.busy ? 'disabled' : ''}>PALPITAR ↗</button></div>
    </form>
    ${canChallenge ? `<button class="challenge-button" data-action="${online ? 'online-challenge' : 'local-challenge'}" ${state.busy ? 'disabled' : ''}>🦆 &nbsp;NEM A PATO!</button>` : ''}
    <p class="sync-hint">Só vale um número inteiro maior que o palpite anterior.</p>
  </div>`;
}

function chatMarkup() {
  const items = state.messages.map((message) => `<div class="chat-message ${message.uid === state.currentUser?.uid ? 'own-message' : ''}">
    <div class="chat-message-meta"><strong>${escapeHtml(message.name || 'Jogador')}</strong><time>${message.createdAt?.toDate ? message.createdAt.toDate().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}</time></div>
    <p>${escapeHtml(message.text)}</p></div>`).join('');
  return `<section class="chat-panel"><div class="chat-heading"><span class="chat-icon">💬</span><div><h3>Chat da partida</h3><p>Conversem, negociem e tentem blefar.</p></div><span class="chat-live"><i></i> AO VIVO</span></div>
    <div class="chat-messages" id="chat-messages">${items || '<div class="chat-empty">A conversa começa aqui. Mande o primeiro palpite ou provoque o adversário! 😄</div>'}</div>
    <form id="chat-form" class="chat-form"><input id="chat-input" class="text-input" maxlength="500" value="${escapeHtml(state.chatDraft)}" placeholder="Escreva uma mensagem…" autocomplete="off" /><button type="submit" aria-label="Enviar mensagem" ${state.busy ? 'disabled' : ''}>➤</button></form></section>`;
}

function renderOnlineRoom() {
  const room = state.room;
  const question = findQuestion(room.currentQuestionId);
  const players = onlinePlayers(room);
  const uid = state.currentUser?.uid;
  root.innerHTML = `<div class="ambient ambient-one"></div><div class="ambient ambient-two"></div><div class="page-wrap">
    <header class="topbar"><a class="brand" href="./" data-action="exit-room"><span class="brand-duck">🦆</span><span>NEM A PATO<span class="brand-dot">!</span></span></a><div class="topbar-tag"><span class="pulse-dot"></span> ONLINE COM CHAT</div></header>
    <section class="game-layout">
      <div class="room-bar"><button class="back-button" data-action="exit-room">← &nbsp;Sair</button><div class="room-code-block"><span class="room-overline">CÓDIGO DA SALA</span><strong>${escapeHtml(state.roomCode)}</strong></div><button class="icon-button" data-action="copy-code" aria-label="Copiar código">▣</button><button class="share-button" data-action="share-room">↗ &nbsp;Convidar</button></div>
      <div class="connection-row"><span class="connection-status ${state.connected ? 'online' : ''}"><span></span>${state.connected ? 'Sincronizado em tempo real' : 'Reconectando…'}</span><span class="players-count">${players.length}/2 aparelhos</span></div>
      ${renderPlayerScores(players, room.turnUid, room.roundLoserUid)}
      ${renderQuestionCard(question, room, true)}
      ${renderActionArea(room, true, uid, question)}
      ${chatMarkup()}
      <div class="room-footnote">🦆 &nbsp;Quem acumular mais patos perde. Se o palpite passar da resposta, o palpiteiro leva; se não passar, o desafiante leva.</div>
    </section>${toastMarkup()}${footerMarkup()}</div>`;
  const scroller = document.querySelector('#chat-messages');
  if (scroller) scroller.scrollTop = scroller.scrollHeight;
}

function localPlayers(room) {
  return room.players.map((player, index) => ({ ...player, uid: String(index), cards: room.cards[index] || 0 }));
}

function renderLocalRoom() {
  const room = state.localRoom;
  const question = findQuestion(room.currentQuestionId);
  const players = localPlayers(room);
  const displayRoom = { ...room, players: room.players, turnIndex: room.turnIndex, lastGuessByIndex: room.lastGuessByIndex };
  root.innerHTML = `<div class="ambient ambient-one"></div><div class="ambient ambient-two"></div><div class="page-wrap">
    <header class="topbar"><a class="brand" href="./" data-action="exit-local"><span class="brand-duck">🦆</span><span>NEM A PATO<span class="brand-dot">!</span></span></a><div class="topbar-tag"><span class="pulse-dot"></span> MODO PRESENCIAL · SEM CHAT</div></header>
    <section class="game-layout">
      <div class="room-bar"><button class="back-button" data-action="exit-local">← &nbsp;Sair</button><div class="room-code-block"><span class="room-overline">MODO</span><strong>PRESENCIAL</strong></div><span class="offline-pill">SEM INTERNET</span></div>
      ${renderPlayerScores(players, String(room.turnIndex), String(room.roundLoserIndex))}
      ${renderQuestionCard(question, displayRoom, false)}
      ${renderActionArea(room, false, null, question)}
      <div class="room-footnote">👥 &nbsp;Passe o aparelho para quem estiver com a vez. Quem acumular mais patos perde.</div>
    </section>${toastMarkup()}${footerMarkup()}</div>`;
}

function render() {
  if (state.localRoom) return renderLocalRoom();
  if (state.roomCode && state.room) return renderOnlineRoom();
  if (state.view === 'home' || !state.roomCode) return renderHome();
}

async function loadFirebase() {
  if (!firebaseConfigReady) throw new Error('FIREBASE_NOT_CONFIGURED');
  if (state.auth && state.db && state.firestore) return;
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
  if (!state.auth || !state.db || !state.firestore) await loadFirebase();
  if (!state.auth || !state.db || !state.firestore) throw new Error('FIREBASE_NOT_CONFIGURED');
  if (typeof state.auth.authStateReady === 'function') await state.auth.authStateReady();
  if (state.auth.currentUser) {
    state.currentUser = state.auth.currentUser;
    return state.currentUser;
  }
  const credential = await state.firestore.signInAnonymously(state.auth);
  state.currentUser = credential.user;
  return credential.user;
}

function watchMessages(code) {
  state.unsubscribeMessages?.();
  const messagesRef = state.firestore.collection(state.db, 'rooms', code, 'messages');
  const messagesQuery = state.firestore.query(messagesRef, state.firestore.orderBy('createdAt', 'asc'), state.firestore.limit(80));
  state.unsubscribeMessages = state.firestore.onSnapshot(messagesQuery, (snapshot) => {
    state.messages = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    if (state.roomCode === code && state.room?.mode === 'chat') render();
  }, (error) => {
    state.error = error.message || 'Não foi possível carregar o chat.';
    render();
  });
}

function watchRoom(code) {
  state.unsubscribeRoom?.();
  state.connected = false;
  const roomRef = state.firestore.doc(state.db, 'rooms', code);
  state.unsubscribeRoom = state.firestore.onSnapshot(roomRef, (snapshot) => {
    if (!snapshot.exists()) {
      state.room = null; state.roomCode = null; state.connected = false;
      state.error = 'Esta sala não existe mais. Crie outra ou entre com um novo código.';
      render(); return;
    }
    state.room = snapshot.data();
    state.connected = true;
    state.error = '';
    if (state.room.mode === 'chat') watchMessagesOnce(code);
    render();
  }, (error) => {
    state.connected = false; state.error = error.message || 'Falha na conexão com a sala.'; render();
  });
}
let watchingMessagesFor = null;
function watchMessagesOnce(code) {
  if (watchingMessagesFor === code) return;
  watchingMessagesFor = code;
  watchMessages(code);
}

function getFriendlyError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('ROOM_NOT_FOUND')) return 'Não encontramos uma sala com esse código. Confira e tente novamente.';
  if (message.includes('ROOM_FULL')) return 'Essa sala já tem dois aparelhos conectados.';
  if (message.includes('ROOM_CODE_TAKEN')) return 'O código já está em uso. Tente criar novamente.';
  if (message.includes('permission-denied')) return 'O Firebase bloqueou essa ação. Confira as regras atualizadas do Firestore.';
  if (message.includes('auth/operation-not-allowed')) return 'Ative o provedor de autenticação anônima no Firebase.';
  if (message.includes('FIREBASE_NOT_CONFIGURED')) return 'A configuração do Firebase não foi carregada.';
  if (message.includes('network-request-failed') || message.includes('unavailable')) return 'Sem conexão com o servidor. Verifique a internet.';
  return message || 'Não foi possível concluir. Tente novamente.';
}

async function createOnlineRoom(event) {
  event?.preventDefault();
  const name = cleanName(document.querySelector('#create-player-name')?.value, 'Jogador 1');
  state.busy = true; state.error = ''; state.notice = ''; render();
  try {
    const user = await ensureUser();
    let code = '';
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const candidate = createCode();
      const ref = state.firestore.doc(state.db, 'rooms', candidate);
      const created = await state.firestore.runTransaction(state.db, async (transaction) => {
        const snapshot = await transaction.get(ref);
        if (snapshot.exists()) return false;
        transaction.set(ref, {
          code: candidate, ownerId: user.uid, playerIds: [user.uid], playerNames: { [user.uid]: name }, mode: 'chat',
          currentQuestionId: null, revealed: false, usedQuestionIds: [], round: 0, status: 'waiting',
          turnUid: user.uid, starterUid: user.uid, lastGuess: null, lastGuessByUid: null,
          challengedByUid: null, roundLoserUid: null, cardsByPlayer: { [user.uid]: 0 }, lastActionMs: 0,
          createdAt: state.firestore.serverTimestamp(), updatedAt: state.firestore.serverTimestamp(),
        });
        return true;
      });
      if (created) { code = candidate; break; }
    }
    if (!code) throw new Error('ROOM_CODE_TAKEN');
    state.roomCode = code; state.view = 'room'; state.messages = []; watchingMessagesFor = null;
    watchRoom(code);
  } catch (error) { state.error = getFriendlyError(error); }
  finally { state.busy = false; render(); }
}

async function joinOnlineRoom(event) {
  event?.preventDefault();
  const code = state.codeInput.trim().toUpperCase();
  const name = cleanName(document.querySelector('#join-player-name')?.value, 'Jogador 2');
  if (code.length !== 6) { state.error = 'Digite o código completo de 6 caracteres.'; render(); return; }
  state.busy = true; state.error = ''; state.notice = ''; render();
  try {
    const user = await ensureUser();
    const ref = state.firestore.doc(state.db, 'rooms', code);
    await state.firestore.runTransaction(state.db, async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists()) throw new Error('ROOM_NOT_FOUND');
      const data = snapshot.data();
      if (data.playerIds?.includes(user.uid)) return;
      if ((data.playerIds?.length ?? 0) >= 2) throw new Error('ROOM_FULL');
      const playerIds = [...(data.playerIds || []), user.uid];
      transaction.update(ref, {
        playerIds, playerNames: { ...(data.playerNames || {}), [user.uid]: name },
        cardsByPlayer: { ...(data.cardsByPlayer || {}), [user.uid]: 0 },
        updatedAt: state.firestore.serverTimestamp(),
      });
    });
    state.roomCode = code; state.view = 'room'; state.messages = []; watchingMessagesFor = null;
    watchRoom(code);
  } catch (error) { state.error = getFriendlyError(error); }
  finally { state.busy = false; render(); }
}

function pickUnusedQuestion(usedIds) {
  let available = questionBank.filter((item) => !usedIds.includes(item.id));
  const nextUsed = available.length ? [...usedIds] : [];
  if (!available.length) available = questionBank;
  const selected = available[Math.floor(Math.random() * available.length)];
  nextUsed.push(selected.id);
  return { selected, nextUsed };
}

async function nextOnlineQuestion() {
  if (!state.roomCode) return;
  state.busy = true; state.error = ''; state.notice = ''; render();
  try {
    const user = await ensureUser();
    const ref = state.firestore.doc(state.db, 'rooms', state.roomCode);
    await state.firestore.runTransaction(state.db, async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists()) throw new Error('ROOM_NOT_FOUND');
      const data = snapshot.data();
      if (!data.playerIds?.includes(user.uid)) throw new Error('Você não faz parte desta sala.');
      if (data.playerIds.length !== 2) throw new Error('Aguarde o segundo aparelho entrar na sala.');
      if (data.currentQuestionId && !data.revealed) throw new Error('Resolva a rodada atual antes de sortear outra pergunta.');
      if (data.starterUid !== user.uid) throw new Error('Quem desafiou começa a próxima rodada.');
      if (Date.now() - (data.lastActionMs || 0) < 900) throw new Error('Aguarde um instante para sortear novamente.');
      const { selected, nextUsed } = pickUnusedQuestion(data.usedQuestionIds || []);
      transaction.update(ref, {
        currentQuestionId: selected.id, revealed: false, usedQuestionIds: nextUsed,
        round: (data.round || 0) + 1, status: 'playing', turnUid: data.starterUid,
        lastGuess: null, lastGuessByUid: null, challengedByUid: null, roundLoserUid: null,
        lastActionMs: Date.now(), updatedAt: state.firestore.serverTimestamp(),
      });
    });
  } catch (error) { state.error = getFriendlyError(error); }
  finally { state.busy = false; render(); }
}

async function submitOnlineGuess(event) {
  event?.preventDefault();
  const value = Number(document.querySelector('#guess-value')?.value);
  if (!Number.isSafeInteger(value) || value < 0) { state.error = 'Digite um número inteiro válido, igual ou maior que zero.'; render(); return; }
  state.busy = true; state.error = ''; state.notice = ''; render();
  try {
    const user = await ensureUser();
    const ref = state.firestore.doc(state.db, 'rooms', state.roomCode);
    await state.firestore.runTransaction(state.db, async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists()) throw new Error('ROOM_NOT_FOUND');
      const data = snapshot.data();
      if (data.turnUid !== user.uid) throw new Error('Não é a sua vez de palpitar.');
      if (data.revealed || !data.currentQuestionId) throw new Error('Não há uma rodada aberta para palpitar.');
      if (data.lastGuess !== null && value <= data.lastGuess) throw new Error(`Seu palpite precisa ser maior que ${formatNumber(data.lastGuess)}.`);
      const nextTurn = data.playerIds.find((id) => id !== user.uid);
      transaction.update(ref, {
        lastGuess: value, lastGuessByUid: user.uid, turnUid: nextTurn,
        lastActionMs: Date.now(), updatedAt: state.firestore.serverTimestamp(),
      });
    });
  } catch (error) { state.error = getFriendlyError(error); }
  finally { state.busy = false; render(); }
}

async function challengeOnline() {
  state.busy = true; state.error = ''; state.notice = ''; render();
  try {
    const user = await ensureUser();
    const ref = state.firestore.doc(state.db, 'rooms', state.roomCode);
    await state.firestore.runTransaction(state.db, async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists()) throw new Error('ROOM_NOT_FOUND');
      const data = snapshot.data();
      if (data.turnUid !== user.uid) throw new Error('Só quem está com a vez pode desafiar.');
      if (data.lastGuess === null || data.lastGuessByUid === user.uid) throw new Error('Faça ou aguarde um palpite antes de desafiar.');
      if (data.revealed) return;
      const question = findQuestion(data.currentQuestionId);
      if (!question) throw new Error('Pergunta não encontrada no banco.');
      const loserUid = data.lastGuess > Number(question.answer) ? data.lastGuessByUid : user.uid;
      const cards = { ...(data.cardsByPlayer || {}) };
      cards[loserUid] = Number(cards[loserUid] || 0) + 1;
      transaction.update(ref, {
        revealed: true, status: 'resolved', challengedByUid: user.uid,
        roundLoserUid: loserUid, starterUid: user.uid, cardsByPlayer: cards,
        lastActionMs: Date.now(), updatedAt: state.firestore.serverTimestamp(),
      });
    });
  } catch (error) { state.error = getFriendlyError(error); }
  finally { state.busy = false; render(); }
}

async function sendChat(event) {
  event?.preventDefault();
  const input = document.querySelector('#chat-input');
  const text = String(input?.value || '').trim().slice(0, 500);
  if (!text || !state.roomCode) return;
  state.chatDraft = '';
  try {
    const user = await ensureUser();
    const name = state.room?.playerNames?.[user.uid] || 'Jogador';
    const messagesRef = state.firestore.collection(state.db, 'rooms', state.roomCode, 'messages');
    await state.firestore.addDoc(messagesRef, {
      uid: user.uid, name, text, createdAt: state.firestore.serverTimestamp(),
    });
  } catch (error) { state.error = getFriendlyError(error); }
  render();
}

function startLocalGame(event) {
  event?.preventDefault();
  const rawNames = document.querySelector('#local-player-names')?.value || '';
  const names = rawNames.split(/[\n,;]+/).map((name) => cleanName(name, '')).filter(Boolean).slice(0, 10);
  const uniqueNames = [...new Map(names.map((name) => [name.toLocaleLowerCase('pt-BR'), name])).values()];
  if (uniqueNames.length < 2) { state.error = 'Informe pelo menos dois nomes diferentes, separados por vírgula ou em linhas.'; render(); return; }
  state.localRoom = {
    players: uniqueNames.map((name) => ({ name })), cards: uniqueNames.map(() => 0),
    currentQuestionId: null, revealed: false, usedQuestionIds: [], round: 0,
    turnIndex: 0, starterIndex: 0, lastGuess: null, lastGuessByIndex: null, roundLoserIndex: null,
  };
  state.error = ''; state.notice = ''; render();
}

function nextLocalQuestion() {
  const room = state.localRoom;
  if (!room || (room.currentQuestionId && !room.revealed)) return;
  const { selected, nextUsed } = pickUnusedQuestion(room.usedQuestionIds);
  Object.assign(room, {
    currentQuestionId: selected.id, revealed: false, usedQuestionIds: nextUsed,
    round: room.round + 1, turnIndex: room.starterIndex,
    lastGuess: null, lastGuessByIndex: null, roundLoserIndex: null,
  });
  state.error = ''; state.notice = ''; render();
}

function submitLocalGuess(event) {
  event?.preventDefault();
  const room = state.localRoom;
  const value = Number(document.querySelector('#guess-value')?.value);
  if (!Number.isSafeInteger(value) || value < 0) { state.error = 'Digite um número inteiro válido, igual ou maior que zero.'; render(); return; }
  if (room.lastGuess !== null && value <= room.lastGuess) { state.error = `O palpite precisa ser maior que ${formatNumber(room.lastGuess)}.`; render(); return; }
  room.lastGuess = value;
  room.lastGuessByIndex = room.turnIndex;
  room.turnIndex = (room.turnIndex + 1) % room.players.length;
  state.error = ''; state.notice = ''; render();
}

function challengeLocal() {
  const room = state.localRoom;
  if (!room || room.lastGuess === null || room.turnIndex === room.lastGuessByIndex) return;
  const question = findQuestion(room.currentQuestionId);
  const loserIndex = room.lastGuess > Number(question.answer) ? room.lastGuessByIndex : room.turnIndex;
  room.cards[loserIndex] += 1;
  room.roundLoserIndex = loserIndex;
  room.starterIndex = room.turnIndex;
  room.revealed = true;
  state.error = ''; state.notice = ''; render();
}

async function copyCode() {
  if (!state.roomCode) return;
  try { await navigator.clipboard.writeText(state.roomCode); state.notice = 'Código copiado! Envie para o outro aparelho.'; }
  catch { state.notice = `Código da sala: ${state.roomCode}`; }
  render();
}

async function shareRoom() {
  if (!state.roomCode) return;
  const url = `${location.origin}${location.pathname}?sala=${state.roomCode}`;
  try {
    if (navigator.share) await navigator.share({ title: 'Nem a Pato!', text: `Entre na minha sala usando o código ${state.roomCode}.`, url });
    else { await navigator.clipboard.writeText(`${state.roomCode} — ${url}`); state.notice = 'Código e link copiados!'; render(); }
  } catch (error) { if (error?.name !== 'AbortError') { state.notice = `Código: ${state.roomCode}`; render(); } }
}

function leaveOnlineRoom() {
  state.unsubscribeRoom?.(); state.unsubscribeMessages?.();
  state.unsubscribeRoom = null; state.unsubscribeMessages = null; watchingMessagesFor = null;
  state.roomCode = null; state.room = null; state.messages = []; state.currentUser = null;
  state.connected = false; state.error = ''; state.notice = ''; state.view = 'home';
  history.replaceState({}, '', location.pathname);
  renderHome();
}

function leaveLocalRoom() {
  state.localRoom = null; state.error = ''; state.notice = ''; renderHome();
}

root.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (button.tagName === 'A') event.preventDefault();
  if (action === 'exit-room') leaveOnlineRoom();
  if (action === 'exit-local') leaveLocalRoom();
  if (action === 'copy-code') void copyCode();
  if (action === 'share-room') void shareRoom();
  if (action === 'online-next') void nextOnlineQuestion();
  if (action === 'online-challenge') void challengeOnline();
  if (action === 'local-next') nextLocalQuestion();
  if (action === 'local-challenge') challengeLocal();
  if (action === 'dismiss-toast') { state.error = ''; state.notice = ''; render(); }
});

root.addEventListener('submit', (event) => {
  if (event.target.id === 'local-start-form') startLocalGame(event);
  if (event.target.id === 'online-create-form') void createOnlineRoom(event);
  if (event.target.id === 'online-join-form') void joinOnlineRoom(event);
  if (event.target.id === 'guess-form') {
    if (state.localRoom) submitLocalGuess(event);
    else void submitOnlineGuess(event);
  }
  if (event.target.id === 'chat-form') void sendChat(event);
});

root.addEventListener('input', (event) => {
  if (event.target.id === 'room-code') {
    state.codeInput = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    const join = document.querySelector('#online-join-form button[type="submit"]');
    if (join) join.disabled = state.busy || state.codeInput.length !== 6;
  }
  if (event.target.id === 'chat-input') state.chatDraft = event.target.value;
});

// O Firebase é carregado apenas quando alguém escolhe o modo online.
// Assim, o modo presencial funciona sem internet e sem depender dos SDKs remotos.
renderHome();
