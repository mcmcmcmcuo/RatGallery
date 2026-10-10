const PER_PAGE = 40;
const state = {
  items: [], itemsByName: new Map(), tree: '', q: '', tags: new Set(),
  sort: 'time-desc', page: 1,
  roots: [], childrenOf: {}, parentOf: {},
  batchMode: false,
  selected: new Set(),
  batchAction: null,
  editMode: false,
  editing: null,
};

const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, '0');

/* ---------- 标签层级 ---------- */

function parseTree(text) {
  const parentOf = {};
  const childrenOf = {};
  const allTags = new Set();

  for (let line of (text || '').split('\n')) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split('/').map(s => s.trim()).filter(Boolean);
    if (!parts.length) continue;

    for (const t of parts) allTags.add(t);
    for (let i = 1; i < parts.length; i++) {
      const p = parts[i - 1], c = parts[i];
      parentOf[c] = p;
      if (!childrenOf[p]) childrenOf[p] = [];
      if (!childrenOf[p].includes(c)) childrenOf[p].push(c);
    }
  }

  const roots = [...allTags].filter(t => !parentOf[t]);
  return { roots, childrenOf, parentOf };
}

function expandTags(tags) {
  const out = new Set();
  for (const t of tags) {
    out.add(t);
    let cur = t;
    while (state.parentOf[cur]) {
      cur = state.parentOf[cur];
      if (out.has(cur)) break;
      out.add(cur);
    }
  }
  return [...out];
}

/* ---------- 工具 ---------- */

function fmtTime(ts) {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toLocalInput(ts) {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(t._tid);
  t._tid = setTimeout(() => { t.style.display = 'none'; }, 1500);
}

/* ---------- 筛选 ---------- */

function filtered() {
  const words = state.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const sel = [...state.tags];
  let list = state.items.filter(it => {
    if (sel.length) {
      const full = expandTags(it.tags);
      if (!sel.every(t => full.includes(t))) return false;
    }
    if (!words.length) return true;
    const hay = (it.name + ' ' + it.tags.join(' ') + ' ' + it.note).toLowerCase();
    return words.every(w => hay.includes(w));
  });
  const s = state.sort;
  list = list.slice().sort((a, b) => {
    if (s === 'time-desc') return b.time - a.time;
    if (s === 'time-asc') return a.time - b.time;
    if (s === 'name-asc') return a.name.localeCompare(b.name, 'zh', { numeric: true });
    if (s === 'name-desc') return b.name.localeCompare(a.name, 'zh', { numeric: true });
    return 0;
  });
  return list;
}

/* ---------- 保存 ---------- */

async function saveItem(name, patch) {
  const res = await fetch('/api/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ name }, patch)),
  });
  if (!res.ok) throw new Error('保存失败');
}

async function saveTree(text) {
  const res = await fetch('/api/tree', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tree: text }),
  });
  if (!res.ok) throw new Error('保存失败');
}

/* ---------- 灯箱 ---------- */

function openLightbox(src, type) {
  const box = $('#lightbox');
  box.innerHTML = '';
  const el = document.createElement(type === 'video' ? 'video' : 'img');
  el.src = src;
  if (type === 'video') { el.controls = true; el.autoplay = true; }
  box.appendChild(el);
  box.classList.add('on');
}

function closeLightbox() {
  $('#lightbox').innerHTML = '';
  $('#lightbox').classList.remove('on');
}

/* ---------- 标签栏 ---------- */

function renderTagBar() {
  const bar = $('#tagbar');
  bar.innerHTML = '';
  for (const root of state.roots) {
    const pb = document.createElement('button');
    pb.className = 'tagbtn' + (state.tags.has(root) ? ' on' : '');
    pb.textContent = root;
    pb.onclick = () => {
      state.tags.has(root) ? state.tags.delete(root) : state.tags.add(root);
      state.page = 1;
      render();
    };
    bar.appendChild(pb);

    for (const c of (state.childrenOf[root] || [])) {
      const b = document.createElement('button');
      b.className = 'tagbtn' + (state.tags.has(c) ? ' on' : '');
      b.textContent = '·' + c;
      b.style.fontSize = '11px';
      b.style.color = '#555';
      b.onclick = () => {
        state.tags.has(c) ? state.tags.delete(c) : state.tags.add(c);
        state.page = 1;
        render();
      };
      bar.appendChild(b);
    }
  }
}

/* ---------- 卡片上的标签 ---------- */

function renderTagsDisplay(el, it) {
  el.innerHTML = '';
  const own = new Set(it.tags);
  const full = expandTags(it.tags);
  const add = (t, inherited) => {
    const s = document.createElement('span');
    s.className = 'tag' + (inherited ? ' parent-tag' : '');
    s.textContent = t;
    if (inherited) s.title = '继承自子标签';
    s.onclick = (e) => {
      if (state.batchMode || state.editMode) return;
      e.stopPropagation();
      state.tags.add(t); state.page = 1; render();
    };
    el.appendChild(s);
  };
  for (const t of it.tags) add(t, false);
  for (const t of full) if (!own.has(t)) add(t, true);
}

/* ---------- 候选标签 ---------- */

function buildCandidates(container, tagsInput) {
  container.innerHTML = '';
  const cur = () => tagsInput.value.split(',').map(s => s.trim()).filter(Boolean);

  const makeCand = (tag) => {
    const c = document.createElement('span');
    c.className = 'cand' + (cur().includes(tag) ? ' on' : '');
    c.textContent = tag;
    c.onclick = (e) => {
      e.stopPropagation();
      const now = cur();
      const i = now.indexOf(tag);
      if (i >= 0) now.splice(i, 1);
      else now.push(tag);
      tagsInput.value = now.join(', ');
      buildCandidates(container, tagsInput);
    };
    return c;
  };

  if (!state.roots.length) {
    const hint = document.createElement('span');
    hint.className = 'empty-hint';
    hint.textContent = '未定义标签';
    container.appendChild(hint);
    return;
  }

  for (const root of state.roots) {
    const row = document.createElement('div');
    row.className = 'group-row';

    const children = state.childrenOf[root] || [];
    if (children.length > 0) {
      const plabel = document.createElement('span');
      plabel.className = 'group-label';
      plabel.textContent = root;
      row.appendChild(plabel);
    }

    row.appendChild(makeCand(root));
    for (const c of children) {
      const el = makeCand(c);
      el.style.marginLeft = '3px';
      row.appendChild(el);
    }
    container.appendChild(row);
  }
}

/* ---------- 单张编辑 ---------- */

function enterEditMode() {
  if (state.batchMode) exitBatchMode();
  state.editMode = true;
  state.editing = null;
  document.body.classList.add('edit-mode');
  $('#editPanel').classList.add('on');
  $('#editBtn').textContent = '退出';
  $('#editTitle').textContent = '';
  $('#editTags').value = '';
  $('#editCands').innerHTML = '';
  $('#editNote').value = '';
  $('#editTime').value = '';
  render();
}

function exitEditMode() {
  state.editMode = false;
  state.editing = null;
  document.body.classList.remove('edit-mode');
  $('#editPanel').classList.remove('on');
  $('#editBtn').textContent = '编辑';
  render();
}

function selectForEdit(it) {
  state.editing = it;
  $('#editTitle').textContent = it.name;
  $('#editTags').value = it.tags.join(', ');
  $('#editNote').value = it.note || '';
  $('#editTime').value = toLocalInput(it.time);
  buildCandidates($('#editCands'), $('#editTags'));
  document.querySelectorAll('.card.editing').forEach(c => c.classList.remove('editing'));
  const card = document.querySelector(`.card[data-name="${CSS.escape(it.name)}"]`);
  if (card) card.classList.add('editing');
}

/* ---------- 卡片 ---------- */

function makeCard(it) {
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.name = it.name;
  if (state.batchMode && state.selected.has(it.name)) card.classList.add('selected');
  if (state.editMode && state.editing && state.editing.name === it.name) card.classList.add('editing');

  const check = document.createElement('div');
  check.className = 'batch-check';
  card.appendChild(check);

  const src = '/images/' + encodeURIComponent(it.name);

  let media;
  if (it.type === 'video') {
    media = document.createElement('video');
    media.src = src;
    media.className = 'thumb';
    media.preload = 'metadata';
    media.muted = true;
  } else {
    media = document.createElement('img');
    media.src = src;
    media.className = 'thumb';
    media.loading = 'lazy';
  }
  media.onclick = (e) => {
    e.stopPropagation();
    if (state.batchMode) toggleSelect(it.name, card);
    else if (state.editMode) selectForEdit(it);
    else openLightbox(src, it.type);
  };
  card.appendChild(media);

  const nm = document.createElement('div');
  nm.className = 'nm';
  nm.textContent = it.name;
  card.appendChild(nm);

  const tagsLine = document.createElement('div');
  renderTagsDisplay(tagsLine, it);
  card.appendChild(tagsLine);

  const metaLine = document.createElement('div');
  metaLine.className = 'meta';
  metaLine.textContent = fmtTime(it.time);
  card.appendChild(metaLine);

  const noteLine = document.createElement('div');
  noteLine.className = 'note';
  noteLine.textContent = it.note || '';
  noteLine.style.display = it.note ? '' : 'none';
  card.appendChild(noteLine);

  card._tagsLine = tagsLine;
  card._metaLine = metaLine;
  card._noteLine = noteLine;

  return card;
}

/* ---------- 批量 ---------- */

function toggleSelect(name, card) {
  if (state.selected.has(name)) {
    state.selected.delete(name);
    card.classList.remove('selected');
  } else {
    state.selected.add(name);
    card.classList.add('selected');
  }
  updateBatchBar();
}

function updateBatchBar() {
  $('#batchCount').textContent = `已选 ${state.selected.size}`;
}

function enterBatchMode() {
  if (state.editMode) exitEditMode();
  state.batchMode = true;
  state.selected.clear();
  state.batchAction = null;
  document.body.classList.add('batch-mode');
  $('#batchBar').classList.add('on');
  $('#batchBtn').textContent = '退出';
  renderBatchPicker();
  updateBatchBar();
  render();
}

function exitBatchMode() {
  state.batchMode = false;
  state.selected.clear();
  state.batchAction = null;
  document.body.classList.remove('batch-mode');
  $('#batchBar').classList.remove('on');
  $('#batchBtn').textContent = '批量';
  render();
}

function renderBatchPicker() {
  const picker = $('#batchTagPicker');
  picker.innerHTML = '';
  if (!state.batchAction) return;

  if (!state.roots.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-hint';
    empty.textContent = '未定义标签';
    picker.appendChild(empty);
    return;
  }

  for (const root of state.roots) {
    const row = document.createElement('div');
    row.className = 'picker-group';

    const children = state.childrenOf[root] || [];
    if (children.length > 0) {
      const plabel = document.createElement('span');
      plabel.className = 'group-label';
      plabel.textContent = root;
      row.appendChild(plabel);
    }

    const mkBtn = (tag) => {
      const b = document.createElement('span');
      b.className = 'cand';
      b.textContent = tag;
      b.onclick = () => applyBatch(state.batchAction, tag);
      return b;
    };

    row.appendChild(mkBtn(root));
    for (const c of children) {
      const el = mkBtn(c);
      el.style.marginLeft = '3px';
      row.appendChild(el);
    }
    picker.appendChild(row);
  }
}

async function applyBatch(action, tag) {
  if (!state.selected.size) { toast('未选择'); return; }
  const patches = [];
  for (const name of state.selected) {
    const item = state.itemsByName.get(name);
    if (!item) continue;
    if (action === 'add') {
      if (item.tags.includes(tag)) continue;
      patches.push({ item, newTags: [...item.tags, tag] });
    } else {
      if (!item.tags.includes(tag)) continue;
      patches.push({ item, newTags: item.tags.filter(t => t !== tag) });
    }
  }
  if (!patches.length) { toast('无变化'); return; }
  try {
    await Promise.all(patches.map(p => saveItem(p.item.name, { tags: p.newTags })));
    for (const p of patches) p.item.tags = p.newTags;
    toast(`${patches.length} 项已更新`);
    renderTagBar();
    render();
    updateBatchBar();
  } catch (e) {
    toast('保存失败');
  }
}

/* ---------- 网格 / 分页 / 渲染 ---------- */

function renderGrid(list) {
  const grid = $('#grid');
  grid.innerHTML = '';
  const start = (state.page - 1) * PER_PAGE;
  const chunk = list.slice(start, start + PER_PAGE);
  if (!chunk.length) {
    grid.innerHTML = '<p style="grid-column:1/-1;color:#888">无匹配</p>';
    return;
  }
  for (const it of chunk) grid.appendChild(makeCard(it));
}

function renderPager(total) {
  const pager = $('#pager');
  pager.innerHTML = '';
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  if (state.page > pages) state.page = pages;
  const mk = (label, target, disabled) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.disabled = !!disabled;
    if (target === state.page) b.className = 'cur';
    else if (!disabled) b.onclick = () => {
      state.page = target;
      render();
      window.scrollTo(0, 0);
    };
    return b;
  };
  pager.appendChild(mk('←', state.page - 1, state.page === 1));
  for (let i = 1; i <= pages; i++) pager.appendChild(mk(String(i), i, false));
  pager.appendChild(mk('→', state.page + 1, state.page === pages));
}

function render() {
  const list = filtered();
  $('#count').textContent = `${list.length} / ${state.items.length}`;
  renderGrid(list);
  renderPager(list.length);
}

/* ---------- 加载 ---------- */

async function loadList() {
  try {
    const res = await fetch('/api/list');
    const data = await res.json();
    state.items = data.items;
    state.itemsByName = new Map(data.items.map(it => [it.name, it]));
    state.tree = data.tree || '';
    const parsed = parseTree(state.tree);
    state.roots = parsed.roots;
    state.childrenOf = parsed.childrenOf;
    state.parentOf = parsed.parentOf;
    $('#treeInput').value = state.tree;
    renderTagBar();
    render();
  } catch (e) {
    $('#grid').innerHTML = '<p style="padding:20px;color:#c00">无法连接服务器</p>';
  }
}

/* ---------- 事件 ---------- */

$('#q').addEventListener('input', e => {
  state.q = e.target.value; state.page = 1; render();
});
$('#sort').addEventListener('change', e => {
  state.sort = e.target.value; render();
});
$('#clearFilters').onclick = () => {
  state.q = '';
  state.tags.clear();
  state.page = 1;
  $('#q').value = '';
  renderTagBar();
  render();
};
$('#lightbox').addEventListener('click', e => {
  if (e.target.id === 'lightbox') closeLightbox();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeLightbox();
});

$('#saveTreeBtn').onclick = async () => {
  const text = $('#treeInput').value;
  try {
    await saveTree(text);
    state.tree = text;
    const parsed = parseTree(text);
    state.roots = parsed.roots;
    state.childrenOf = parsed.childrenOf;
    state.parentOf = parsed.parentOf;
    toast('已保存');
    renderTagBar();
    render();
    if (state.batchMode) renderBatchPicker();
    if (state.editMode && state.editing) {
      buildCandidates($('#editCands'), $('#editTags'));
    }
  } catch (e) {
    toast('保存失败');
  }
};

$('#editBtn').onclick = () => {
  if (state.editMode) exitEditMode();
  else enterEditMode();
};

$('#editTags').addEventListener('input', () => {
  buildCandidates($('#editCands'), $('#editTags'));
});

$('#editSave').onclick = async () => {
  if (!state.editing) return;
  const it = state.editing;
  const tags = $('#editTags').value.split(',').map(s => s.trim()).filter(Boolean);
  const note = $('#editNote').value;
  const tval = $('#editTime').value;
  const time = tval ? new Date(tval).getTime() / 1000 : it.time;
  try {
    await saveItem(it.name, { tags, note, time });
    it.tags = tags; it.note = note; it.time = time;
    const card = document.querySelector(`.card[data-name="${CSS.escape(it.name)}"]`);
    if (card) {
      renderTagsDisplay(card._tagsLine, it);
      card._metaLine.textContent = fmtTime(it.time);
      card._noteLine.textContent = it.note;
      card._noteLine.style.display = it.note ? '' : 'none';
    }
    renderTagBar();
    toast('已保存');
  } catch (e) {
    toast('保存失败');
  }
};

$('#batchBtn').onclick = () => {
  if (state.batchMode) exitBatchMode();
  else enterBatchMode();
};

$('#batchAddBtn').onclick = () => {
  state.batchAction = state.batchAction === 'add' ? null : 'add';
  renderBatchPicker();
};
$('#batchRemoveBtn').onclick = () => {
  state.batchAction = state.batchAction === 'remove' ? null : 'remove';
  renderBatchPicker();
};
$('#batchAllBtn').onclick = () => {
  const list = filtered();
  const start = (state.page - 1) * PER_PAGE;
  const chunk = list.slice(start, start + PER_PAGE);
  for (const it of chunk) state.selected.add(it.name);
  render();
  updateBatchBar();
};
$('#batchNoneBtn').onclick = () => {
  state.selected.clear();
  render();
  updateBatchBar();
};
$('#batchExitBtn').onclick = exitBatchMode;

loadList();