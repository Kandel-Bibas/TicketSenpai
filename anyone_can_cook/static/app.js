'use strict';

/* ==========================================================================
   Anyone Can Cook - single-page frontend (no build step, no dependencies)

   Layout of this file:
     1. helpers      - $, esc(), setHTML(), api(), formatting
     2. templates    - functions that turn data into HTML strings
     3. views        - one function per page (feed, recipes, search, user)
     4. sidebar/auth - composer, login/register, header
     5. events       - click/submit delegation and the router
   ========================================================================== */

const state = { me: null, items: new Map(), authMode: 'login' };

/* ------------------------------ 1. helpers ------------------------------ */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = (value) => String(value ?? '');

// All HTML rendering goes through here.
function setHTML(el, html) { el.innerHTML = html; }

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch (_) { /* non-JSON response */ }
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status });
  return data;
}

function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts.replace(' ', 'T') + 'Z');
  return isNaN(d) ? ts : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function remember(kind, items) { items.forEach((it) => state.items.set(kind + ':' + it.id, it)); }
const isMine = (item) => state.me && state.me.id === item.user_id;

/* ----------------------------- 2. templates ----------------------------- */
function ownerButtons(kind, item) {
  if (!isMine(item)) return '';
  return `<button class="link" data-action="edit" data-kind="${kind}" data-id="${item.id}">Edit</button>
          <button class="link danger" data-action="delete" data-kind="${kind}" data-id="${item.id}">Delete</button>`;
}

function postCard(p) {
  remember('post', [p]);
  const n = p.comment_count;
  return `<article class="card" id="post-${p.id}">
    <div class="meta">
      <a class="name" href="#/user/${p.user_id}">${esc(p.username)}</a>
      <span>${esc(fmtDate(p.timestamp))}</span>
      ${p.media_type !== 'text' ? `<span class="tag">${esc(p.media_type)}</span>` : ''}
    </div>
    <p class="body">${esc(p.content)}</p>
    <div class="actions">
      <button class="link" data-action="toggle-comments" data-id="${p.id}">${n} comment${n === 1 ? '' : 's'}</button>
      ${ownerButtons('post', p)}
    </div>
    <div class="comments" hidden></div>
  </article>`;
}

// Recipes are stored as one text field. "Title: item, item, item" renders as a
// heading plus an ingredient list; anything else renders as plain text.
function parseRecipe(text) {
  const i = text.indexOf(':');
  if (i > 0 && i <= 60 && !text.slice(0, i).includes('\n')) {
    const items = text.slice(i + 1).split(/,|\n/).map((s) => s.trim().replace(/\.$/, '').replace(/^and\s+/i, '')).filter(Boolean);
    if (items.length > 1) return { title: text.slice(0, i).trim(), items };
  }
  return { title: '', items: [], raw: text };
}

function stars(r) {
  const mine = r.my_rating || 0;
  return [1, 2, 3, 4, 5].map((n) =>
    `<button type="button" class="${n <= mine ? 'lit' : ''}" data-action="rate" data-id="${r.id}" data-score="${n}"
       ${state.me ? '' : 'disabled'} aria-label="Rate ${n} out of 5">★</button>`).join('');
}

function recipeCard(r) {
  remember('recipe', [r]);
  const parsed = parseRecipe(r.content);
  const ratingText = r.rating_count
    ? `${r.avg_rating} average · ${r.rating_count} rating${r.rating_count === 1 ? '' : 's'}`
    : 'No ratings yet';
  const body = parsed.title
    ? `<h3>${esc(parsed.title)}</h3><ul>${parsed.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
    : `<p class="body">${esc(parsed.raw)}</p>`;
  return `<article class="recipe" id="recipe-${r.id}">
    ${body}
    <div class="meta">
      <a class="name" href="#/user/${r.user_id}">${esc(r.username)}</a>
      ${r.media_type !== 'text' ? `<span class="tag">${esc(r.media_type)}</span>` : ''}
    </div>
    <div class="actions">
      <span class="rating-text">${esc(ratingText)}</span>
      <span class="stars" title="${state.me ? 'Your rating' : 'Log in to rate'}">${stars(r)}</span>
      ${ownerButtons('recipe', r)}
    </div>
  </article>`;
}

function commentRow(c) {
  return `<div class="comment" id="comment-${c.id}">
    <p><a class="name" href="#/user/${c.user_id}"><b>${esc(c.username)}</b></a> ${esc(c.content)}</p>
    ${isMine(c) ? `<button class="link danger" data-action="delete-comment" data-id="${c.id}" data-post="${c.post_id}">Delete</button>` : ''}
  </div>`;
}

function commentsBlock(postId, comments) {
  const form = state.me
    ? `<form class="comment-form" data-post="${postId}">
         <input name="content" maxlength="1000" placeholder="Add a comment" aria-label="Add a comment" required>
         <button class="primary" type="submit">Post</button></form>`
    : `<p class="sub">Log in to join the conversation.</p>`;
  return (comments.length ? comments.map(commentRow).join('') : '<p class="sub">No comments yet.</p>') + form;
}

const emptyBox = (msg) => `<div class="empty">${esc(msg)}</div>`;
const list = (items, tpl, emptyMsg) => (items.length ? items.map(tpl).join('') : emptyBox(emptyMsg));

/* ------------------------------- 3. views ------------------------------- */
const view = () => $('#view');

async function showFeed() {
  const { posts } = await api('/posts');
  setHTML(view(), `<h1>Feed</h1><p class="sub">What everyone is cooking.</p>` +
    list(posts, postCard, 'No posts yet. Share the first one.'));
}

async function showRecipes() {
  const { recipes } = await api('/recipes');
  setHTML(view(), `<h1>Recipes</h1><p class="sub">Rate the ones you've tried.</p>` +
    list(recipes, recipeCard, 'No recipes yet. Add the first one.'));
}

async function showSearch(q) {
  const res = await api('/search?q=' + encodeURIComponent(q));
  const people = res.users.length
    ? `<h2 class="section-title">Cooks</h2><div class="user-list">${res.users.map((u) =>
        `<a href="#/user/${u.id}">${esc(u.username)}</a>`).join('')}</div>` : '';
  const recipes = res.recipes.length ? `<h2 class="section-title">Recipes</h2>${res.recipes.map(recipeCard).join('')}` : '';
  const posts = res.posts.length ? `<h2 class="section-title">Posts</h2>${res.posts.map(postCard).join('')}` : '';
  const none = !people && !recipes && !posts ? emptyBox('Nothing matched. Try a different word.') : '';
  setHTML(view(), `<h1>Results for “${esc(q)}”</h1>${people}${recipes}${posts}${none}`);
}

async function showUser(id) {
  const [{ profile: p }, { posts }, { recipes }] = await Promise.all([
    api('/users/' + id), api('/posts?user_id=' + id), api('/recipes?user_id=' + id)]);
  const follow = state.me && state.me.id !== p.id
    ? `<button data-action="follow" data-id="${p.id}" data-following="${p.is_following}" class="${p.is_following ? '' : 'primary'}">
         ${p.is_following ? 'Unfollow' : 'Follow'}</button>` : '';
  setHTML(view(), `
    <div class="profile-head">
      <div>
        <h1>${esc(p.username)}</h1>
        <div class="sub">Cooking here since ${esc(fmtDate(p.created))}</div>
        <div class="stats"><span><b>${p.followers}</b> followers</span><span><b>${p.following}</b> following</span>
          <span><b>${p.recipe_count}</b> recipes</span><span><b>${p.post_count}</b> posts</span></div>
      </div>${follow}
    </div>
    <h2 class="section-title">Recipes</h2>${list(recipes, recipeCard, 'No recipes yet.')}
    <h2 class="section-title">Posts</h2>${list(posts, postCard, 'No posts yet.')}`);
}

/* --------------------------- 4. sidebar and auth ------------------------- */
function renderWho() {
  setHTML($('#who'), state.me
    ? `<a href="#/user/${state.me.id}">${esc(state.me.username)}</a><button data-action="logout">Log out</button>`
    : `<button data-action="open-auth" data-mode="login">Log in</button>
       <button class="primary" data-action="open-auth" data-mode="register">Sign up</button>`);
}

let composerMode = 'post';
function renderSide() {
  if (!state.me) {
    setHTML($('#side'), `<div class="panel"><h2>Join the kitchen</h2>
      <p class="sub">Log in to post, comment, rate recipes and follow other cooks.</p>
      <button class="primary" data-action="open-auth" data-mode="register">Create an account</button>
      <p class="sub" style="margin:12px 0 0">Demo login: <b>alex_cooks</b> / <b>password123</b></p></div>`);
    return;
  }
  const isRecipe = composerMode === 'recipe';
  setHTML($('#side'), `<form class="panel" id="composer">
    <h2>Share something</h2>
    <div class="seg">
      <button type="button" class="${isRecipe ? '' : 'on'}" data-action="composer-mode" data-mode="post">Post</button>
      <button type="button" class="${isRecipe ? 'on' : ''}" data-action="composer-mode" data-mode="recipe">Recipe</button>
    </div>
    <textarea name="content" rows="5" maxlength="5000" required
      placeholder="${isRecipe ? 'Name: ingredient, ingredient, ingredient' : 'What are you cooking?'}"></textarea>
    <div class="row">
      <select name="media_type" aria-label="Type">
        <option value="text">Text</option><option value="image">Image</option><option value="video">Video</option>
      </select>
      <button class="primary" type="submit" style="flex:1">${isRecipe ? 'Add recipe' : 'Post'}</button>
    </div>
    <p class="form-error" id="composer-error" role="alert"></p>
    <div class="row" style="margin-top:4px">
      <input name="media_url" placeholder="Link to the photo/video (optional)" style="flex:1">
      <button type="button" class="ghost" data-action="check-link">Check link</button>
    </div>
    <p class="sub" id="link-status"></p>
  </form>`);
}

function setAuthMode(mode) {
  state.authMode = mode;
  $$('#auth-dialog .tabs button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  $$('#auth-dialog [data-only="register"]').forEach((el) => (el.hidden = mode !== 'register'));
  $('#auth-form [name=email]').required = mode === 'register';
  $('#auth-form [name=password]').autocomplete = mode === 'register' ? 'new-password' : 'current-password';
  $('#auth-submit').textContent = mode === 'register' ? 'Create account' : 'Log in';
  $('#auth-error').textContent = '';
}

function setUser(user) {
  state.me = user;
  renderWho();
  renderSide();
}

/* ------------------------- 5. events and the router ---------------------- */
async function route() {
  const hash = location.hash || '#/feed';
  const [, name, arg] = hash.match(/^#\/([a-z]+)(?:\/(.*))?/) || [];
  $$('.nav a').forEach((a) => a.classList.toggle('on', a.dataset.nav === name));
  try {
    if (name === 'recipes') await showRecipes();
    else if (name === 'search') await showSearch(decodeURIComponent(arg || ''));
    else if (name === 'user' && /^\d+$/.test(arg || '')) await showUser(arg);
    else await showFeed();
  } catch (e) {
    setHTML(view(), emptyBox(e.message));
  }
}

const reload = () => route();

async function handleAction(btn) {
  const { action, id, kind } = btn.dataset;
  switch (action) {
    case 'open-auth':
      setAuthMode(btn.dataset.mode);
      $('#auth-dialog').showModal();
      break;
    case 'close-dialog':
      btn.closest('dialog').close();
      break;
    case 'logout':
      await api('/logout', { method: 'POST' });
      setUser(null);
      await reload();
      break;
    case 'composer-mode':
      composerMode = btn.dataset.mode;
      renderSide();
      break;
    case 'toggle-comments': {
      const box = $('#post-' + id + ' .comments');
      if (!box.hidden) { box.hidden = true; break; }
      const { comments } = await api(`/posts/${id}/comments`);
      setHTML(box, commentsBlock(id, comments));
      box.hidden = false;
      break;
    }
    case 'delete-comment': {
      await api('/comments/' + id, { method: 'DELETE' });
      const { comments } = await api(`/posts/${btn.dataset.post}/comments`);
      setHTML($('#post-' + btn.dataset.post + ' .comments'), commentsBlock(btn.dataset.post, comments));
      toast('Comment deleted');
      break;
    }
    case 'edit': {
      const item = state.items.get(kind + ':' + id);
      const dlg = $('#edit-dialog');
      dlg.dataset.kind = kind; dlg.dataset.id = id;
      $('#edit-label').firstChild.textContent = `Edit your ${kind}`;
      $('#edit-form [name=content]').value = item.content;
      $('#edit-error').textContent = '';
      dlg.showModal();
      break;
    }
    case 'delete':
      if (!confirm(`Delete this ${kind}? This can't be undone.`)) break;
      await api(`/${kind}s/${id}`, { method: 'DELETE' });
      toast(kind === 'post' ? 'Post deleted' : 'Recipe deleted');
      await reload();
      break;
    case 'rate': {
      const { recipe } = await api(`/recipes/${id}/rating`, { method: 'POST', body: { score: Number(btn.dataset.score) } });
      $('#recipe-' + id).outerHTML = recipeCard(recipe);
      break;
    }
    case 'follow': {
      const following = btn.dataset.following === 'true';
      await api(`/users/${id}/follow`, { method: following ? 'DELETE' : 'POST' });
      await reload();
      break;
    }
    case 'check-link': {
      const url = $('#composer [name=media_url]').value.trim();
      const status = $('#link-status');
      if (!url) { status.textContent = 'Enter a link first.'; break; }
      status.textContent = 'Checking…';
      const res = await api('/tools/check-url?url=' + encodeURIComponent(url));
      status.textContent = res.reachable ? 'Link looks reachable.' : "Couldn't reach that link.";
      break;
    }
  }
}

document.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('[data-action]');
  if (btn) {
    try { await handleAction(btn); }
    catch (e) {
      if (e.status === 401) { setUser(null); setAuthMode('login'); $('#auth-dialog').showModal(); }
      else toast(e.message);
    }
    return;
  }
  const tab = ev.target.closest('#auth-dialog .tabs button');
  if (tab) setAuthMode(tab.dataset.mode);
});

document.addEventListener('submit', async (ev) => {
  const form = ev.target;
  ev.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  try {
    if (form.id === 'search-form') {
      const q = $('#search-input').value.trim();
      if (q) location.hash = '#/search/' + encodeURIComponent(q);
    } else if (form.id === 'auth-form') {
      const path = state.authMode === 'register' ? '/register' : '/login';
      const { user } = await api(path, { method: 'POST', body: data });
      $('#auth-dialog').close();
      form.reset();
      setUser(user);
      toast(`Welcome, ${user.username}`);
      await reload();
    } else if (form.id === 'composer') {
      const kind = composerMode === 'recipe' ? '/recipes' : '/posts';
      await api(kind, { method: 'POST', body: data });
      form.reset();
      toast(composerMode === 'recipe' ? 'Recipe added' : 'Posted');
      if (composerMode === 'recipe') location.hash = '#/recipes';
      await reload();
    } else if (form.id === 'edit-form') {
      const dlg = $('#edit-dialog');
      await api(`/${dlg.dataset.kind}s/${dlg.dataset.id}`, { method: 'PUT', body: data });
      dlg.close();
      toast('Changes saved');
      await reload();
    } else if (form.classList.contains('comment-form')) {
      const postId = form.dataset.post;
      await api(`/posts/${postId}/comments`, { method: 'POST', body: data });
      const { comments } = await api(`/posts/${postId}/comments`);
      setHTML($('#post-' + postId + ' .comments'), commentsBlock(postId, comments));
      const n = comments.length;
      $('#post-' + postId + ' [data-action=toggle-comments]').textContent = `${n} comment${n === 1 ? '' : 's'}`;
    }
  } catch (e) {
    const target = { 'auth-form': '#auth-error', composer: '#composer-error', 'edit-form': '#edit-error' }[form.id];
    if (target) $(target).textContent = e.message; else toast(e.message);
  }
});

window.addEventListener('hashchange', route);

(async function start() {
  try { setUser((await api('/me')).user); } catch (_) { setUser(null); }
  await route();
})();
