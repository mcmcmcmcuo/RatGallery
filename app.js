const PER_PAGE = 40;
const state = {
  items: [], itemsByName: new Map(), tree: '', q: '', tags: new Set(),
  sort: 'time-desc', page: 1,
  groups: [], parentOf: {},
  batchMode: false,
  selected: new Set(),
  batchAction: null,
};
let openEdit = null;

const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, '0');

/* ---------- 标签层级 ---------- */

function parseTree(text) {
  const groupsMap = {};
  const parentOf = {};
  for (let line of (text || '').split('\n')) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split('/').map(s => s.trim()).filter(Boolean);
    if (!parts.length) continue;
    if (parts.length === 1) {
      const p = '未分类';
      (groupsMap[p] = groupsMap[p] || []).push(parts[0]);
    } else {
      const parent = parts[parts.length - 2];
      const leaf = parts[parts.length - 1];
      (groupsMap[parent] = groupsMap[parent] || []).push(leaf);
      parentOf[leaf] = parent;
    }
  }
  for (const k in groupsMap) groupsMap[k] = [...new Set(groupsMap[k])];
  const groups = Object.keys(groupsMap).map(p => ({ parent: p, children: groupsMap[p] }));
  return { groups, parentOf };
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
  for (const g of state.groups) {
    const pb = document.createElement('button');
    pb.className = 'tagbtn' + (state.tags.has(g.parent) ? ' on' : '');
    pb.textContent = g.parent;
    pb.onclick = () => {
      state.tags.has(g.parent) ? state.tags.delete(g.parent) : state.tags.add(g.parent);
      state.page = 1;
      render();
    };
    bar.appendChild(pb);
    for (const c of g.children) {
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
      if (state.batchMode) return;
      e.stopPropagation();
      state.tags.add(t); state.page = 1; render();
    };
    el.appendChild(s);
  };
  for (const t of it.tags) add(t, false);
  for (const t of full) if (!own.has(t)) add(t, true);
}

/* ---------- 编辑框里的候选标签 ---------- */

function buildCandidates(container, etags) {
  container.innerHTML = '';
  const cur = () => etags.value.split(',').map(s => s.trim()).filter(Boolean);

  if (!state.groups.length) {
    const hint = document.createElement('span');
    hint.style.color = '#999';
    hint.style.fontSize = '11px';
    hint.textContent = '（还没定义层级，先在顶部“标签层级”里写几行，或直接手打）';
    container.appendChild(hint);
    return;
  }
  for (const g of state.groups) {
    const row = document.createElement('div');
    row.className = 'group-row';

    const plabel = document.createElement('span');
    plabel.className = 'group-label';
    plabel.textContent = g.parent + '：';
    row.appendChild(plabel);

    const mkCand = (tag, extra) => {
      const c = document.createElement('span');
      c.className = 'cand' + (cur().includes(tag) ? ' on' : '');
      c.textContent = tag;
      if (extra) Object.assign(c.style, extra);
      c.onclick = (e) => {
        e.stopPropagation();
        const now = cur();
        const i = now.indexOf(tag);
        if (i >= 0) now.splice(i, 1);
        else now.push(tag);
        etags.value = now.join(', ');
        buildCandidates(container, etags);
      };
      row.appendChild(c);
    };
    mkCand(g.parent);
    for (const c of g.children) mkCand(c, { marginLeft: '3px' });
    container.appendChild(row);
  }
}

function closeEditBox() {
  if (!openEdit) return;
  const { box, card } = openEdit;
  box.classList.remove('on');
  box.style.top = '';
  box.style.bottom = '';
  box.style.left = '';
  box.style.right = '';
  card.classList.remove('open');
  openEdit = null;
}

/* ---------- 卡片 ---------- */

function makeCard(it) {
  const card = document.createElement('div');
  card.className = 'card';
  if (state.batchMode && state.selected.has(it.name)) card.classList.add('selected');

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

  if (state.batchMode) return card;

  const editBtn = document.createElement('button');
  editBtn.textContent = '编辑';
  editBtn.style.marginTop = '6px';
  card.appendChild(editBtn);

  const box = document.createElement('div');
  box.className = 'editbox';
  box.innerHTML = `
    <label>标签（点下方标签可加/取消，也可手打逗号分隔）</label>
    <input type="text" class="etags">
    <div class="cand-box"></div>
    <label>备注</label>
    <input type="text" class="enote">
    <label>时间</label>
    <input type="datetime-local" class="etime">
    <div class="editbox-actions">
      <button class="cancel">取消</button>
      <button class="save">保存</button>
    </div>
  `;
  card.appendChild(box);

  const etags = box.querySelector('.etags');
  const enote = box.querySelector('.enote');
  const etime = box.querySelector('.etime');
  const candBox = box.querySelector('.cand-box');

  editBtn.onclick = (e) => {
    e.stopPropagation();
    if (openEdit && openEdit.box === box) { closeEditBox(); return; }
    closeEditBox();

    etags.value = it.tags.join(', ');
    enote.value = it.note || '';
    etime.value = toLocalInput(it.time);
    buildCandidates(candBox, etags);

    box.style.top = '100%';
    box.style.bottom = 'auto';
    box.style.left = '-1px';
    box.style.right = 'auto';
    box.classList.add('on');
    card.classList.add('open');

    const cardRect = card.getBoundingClientRect();
    const boxRect = box.getBoundingClientRect();
    if (boxRect.right > window.innerWidth - 8) {
      box.style.left = 'auto';
      box.style.right = '-1px';
    }
    if (cardRect.bottom + boxRect.height > window.innerHeight - 8) {
      box.style.top = 'auto';
      box.style.bottom = '100%';
    }

    openEdit = { card, box };
  };

  box.querySelector('.cancel').onclick = (e) => {
    e.stopPropagation();
    closeEditBox();
  };

  box.querySelector('.save').onclick = async (e) => {
    e.stopPropagation();
    const tags = etags.value.split(',').map(s => s.trim()).filter(Boolean);
    const note = enote.value;
    const tval = etime.value;
    const time = tval ? new Date(tval).getTime() / 1000 : it.time;
    try {
      await saveItem(it.name, { tags, note, time });
      it.tags = tags; it.note = note; it.time = time;
      renderTagsDisplay(tagsLine, it);
      metaLine.textContent = fmtTime(it.time);
      noteLine.textContent = it.note;
      noteLine.style.display = it.note ? '' : 'none';
      closeEditBox();
      renderTagBar();
      toast('已保存到 data.json');
    } catch (err) {
      toast('保存失败');
    }
  };

  return card;
}

/* ---------- 批量操作 ---------- */

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
  $('#batchCount').textContent = `已选 ${state.selected.size} 张`;
}

function enterBatchMode() {
  closeEditBox();
  state.batchMode = true;
  state.selected.clear();
  state.batchAction = null;
  document.body.classList.add('batch-mode');
  $('#batchBar').classList.add('on');
  $('#batchBtn').textContent = '退出批量';
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
  $('#batchBtn').textContent = '批量编辑';
  render();
}

function renderBatchPicker() {
  const picker = $('#batchTagPicker');
  picker.innerHTML = '';
  if (!state.batchAction) {
    picker.innerHTML = '<div class="hint">点“加标签”或“去标签”，然后点下面的标签应用到所有选中的图片。</div>';
    return;
  }
  const verb = state.batchAction === 'add' ? '添加' : '移除';
  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = `点标签 → 给所有选中的图片${verb}该标签（会立即保存）`;
  picker.appendChild(hint);

  if (!state.groups.length) {
    const empty = document.createElement('div');
    empty.style.color = '#999';
    empty.style.fontSize = '12px';
    empty.textContent = '（还没定义层级，先在顶部“标签层级”里写几行）';
    picker.appendChild(empty);
    return;
  }

  for (const g of state.groups) {
    const row = document.createElement('div');
    row.className = 'picker-group';

    const plabel = document.createElement('span');
    plabel.className = 'group-label';
    plabel.textContent = g.parent + '：';
    row.appendChild(plabel);

    const mkBtn = (tag, extra) => {
      const b = document.createElement('span');
      b.className = 'cand';
      b.textContent = tag;
      if (extra) Object.assign(b.style, extra);
      b.onclick = () => applyBatch(state.batchAction, tag);
      row.appendChild(b);
    };
    mkBtn(g.parent);
    for (const c of g.children) mkBtn(c, { marginLeft: '3px' });
    picker.appendChild(row);
  }
}

async function applyBatch(action, tag) {
  if (!state.selected.size) { toast('还没选图片'); return; }
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
  if (!patches.length) { toast('没有变化'); return; }
  try {
    await Promise.all(patches.map(p => saveItem(p.item.name, { tags: p.newTags })));
    for (const p of patches) p.item.tags = p.newTags;
    toast(`已${action === 'add' ? '添加' : '移除'}标签「${tag}」到 ${patches.length} 张`);
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
  openEdit = null;
  const start = (state.page - 1) * PER_PAGE;
  const chunk = list.slice(start, start + PER_PAGE);
  if (!chunk.length) {
    grid.innerHTML = '<p style="grid-column:1/-1;color:#888">没有匹配的内容</p>';
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
  pager.appendChild(mk('← 上一页', state.page - 1, state.page === 1));
  for (let i = 1; i <= pages; i++) pager.appendChild(mk(String(i), i, false));
  pager.appendChild(mk('下一页 →', state.page + 1, state.page === pages));
}

function render() {
  const list = filtered();
  $('#count').textContent = `${list.length} / ${state.items.length} 项`;
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
    state.groups = parsed.groups;
    state.parentOf = parsed.parentOf;
    $('#treeInput').value = state.tree;
    renderTagBar();
    render();
  } catch (e) {
    $('#grid').innerHTML = '<p style="padding:20px;color:#c00">加载失败，请确认 server.py 正在运行</p>';
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

document.addEventListener('click', e => {
  if (!openEdit) return;
  if (openEdit.box.contains(e.target)) return;
  if (e.target.closest('.card') === openEdit.card) return;
  closeEditBox();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeLightbox();
    closeEditBox();
  }
});

$('#saveTreeBtn').onclick = async () => {
  const text = $('#treeInput').value;
  try {
    await saveTree(text);
    state.tree = text;
    const parsed = parseTree(text);
    state.groups = parsed.groups;
    state.parentOf = parsed.parentOf;
    toast('层级已保存');
    renderTagBar();
    render();
    if (state.batchMode) renderBatchPicker();
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
