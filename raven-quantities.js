(function(root) {
  const key = value => String(value || '').trim().toLowerCase();

  function valid(item, names) {
    const split = item.quantity_split;
    if (!split || !Number.isFinite(split.total) || split.total <= 0 || split.total > 10000 || !split.amounts) return false;
    const keys = names.map(key).sort();
    if (JSON.stringify(Object.keys(split.amounts).sort()) !== JSON.stringify(keys)) return false;
    const values = keys.map(name => split.amounts[name]);
    return values.every(value => Number.isFinite(value) && value >= 0)
      && Math.abs(values.reduce((sum, value) => sum + value, 0) - split.total) < 0.000001;
  }

  function total(item) {
    return item.quantity_split?.total
      || Number(String(item.name || '').match(/^\s*(\d+)\s+(?:x\s+)?/i)?.[1])
      || 1;
  }

  function quantity(item, names, name) {
    if (valid(item, names)) return item.quantity_split.amounts[key(name)];
    return total(item) / Math.max(names.length, 1);
  }

  function share(item, names, name) {
    return Number(item.price || 0) * (valid(item, names)
      ? quantity(item, names, name) / item.quantity_split.total
      : 1 / Math.max(names.length, 1));
  }

  function label(item, names, name) {
    return valid(item, names) ? quantity(item, names, name) + ' of ' + item.quantity_split.total : '';
  }

  const api = { valid, quantity, total, share, label };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return;
  }

  root.RavenQuantities = api;

  // `preview` receives only balanced splits. It is local until Save finishes,
  // and `cancel` lets the caller restore the split that was already saved.
  api.edit = (item, names, save, options = {}) => {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-label', 'Adjust quantities');
    dialog.style.cssText = 'background:#121019;color:#eee8fa;border:1px solid #7c3aed66;border-radius:22px;padding:22px;width:min(460px,calc(100% - 28px));box-sizing:border-box;max-height:85dvh;overflow:auto;font-family:inherit';

    const node = (tag, text) => {
      const element = document.createElement(tag);
      element.textContent = text || '';
      return element;
    };
    const heading = node('h3', 'Adjust quantities');
    const description = node('p', item.name);
    const hint = node('p', 'Equal by default. Your bill preview updates as you adjust; save locks this split in. Tax, tip and fees follow each person\'s share.');
    const totalInput = node('input');
    const totalLabel = node('label', 'Total quantity on receipt');
    totalInput.type = 'number';
    totalInput.min = '1';
    totalInput.max = '10000';
    totalInput.step = '1';
    totalInput.value = total(item);
    totalLabel.append(totalInput);
    dialog.append(heading, description, hint, totalLabel);

    const amounts = {};
    const fields = {};
    names.forEach(name => { amounts[key(name)] = quantity(item, names, name); });
    const note = node('p');
    let committed = false;

    function candidate() {
      return { total: Number(totalInput.value), amounts: { ...amounts } };
    }

    function updatePreview() {
      const next = candidate();
      if (!valid({ quantity_split: next }, names)) return false;
      if (typeof options.preview === 'function') options.preview(next);
      return true;
    }

    function sync(preview) {
      names.forEach(name => { fields[key(name)].value = amounts[key(name)]; });
      const used = Object.values(amounts).reduce((sum, value) => sum + value, 0);
      const isBalanced = Math.abs(used - Number(totalInput.value)) < 0.000001;
      note.textContent = Number(used.toFixed(4)) + ' of ' + totalInput.value + ' assigned'
        + (preview && isBalanced ? ' · Live preview' : preview ? ' · Finish assigning to preview' : '');
      if (preview && isBalanced) updatePreview();
    }

    names.forEach(name => {
      const nameKey = key(name);
      const row = node('div');
      const caption = node('span', name);
      const minus = node('button', '−');
      const input = node('input');
      const plus = node('button', '+');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 0';
      caption.style.flex = '1';
      input.type = 'number';
      input.min = '0';
      input.step = 'any';
      input.setAttribute('aria-label', name + ' quantity');
      input.style.width = '68px';
      fields[nameKey] = input;

      function set(value) {
        amounts[nameKey] = Math.max(0, Math.min(Number(totalInput.value), Number(value) || 0));
        if (names.length === 2) {
          const other = key(names.find(person => key(person) !== nameKey));
          amounts[other] = Number((Number(totalInput.value) - amounts[nameKey]).toFixed(6));
        }
        sync(true);
      }

      minus.onclick = () => set(amounts[nameKey] - 1);
      plus.onclick = () => set(amounts[nameKey] + 1);
      input.oninput = () => set(input.value);
      input.onchange = () => set(input.value);
      row.append(caption, minus, input, plus);
      dialog.append(row);
    });

    const equal = node('button', 'Split equally');
    const cancel = node('button', 'Cancel');
    const apply = node('button', 'Save quantities');
    equal.onclick = () => {
      names.forEach(name => { amounts[key(name)] = Number(totalInput.value) / names.length; });
      sync(true);
    };
    totalInput.oninput = equal.onclick;
    totalInput.onchange = equal.onclick;
    cancel.onclick = () => dialog.close();
    apply.onclick = async () => {
      const next = candidate();
      if (!valid({ quantity_split: next }, names)) {
        note.textContent = 'Assign exactly ' + totalInput.value + ' in total before saving.';
        return;
      }
      apply.disabled = true;
      try {
        await save(next);
        committed = true;
        dialog.close();
      } catch (error) {
        note.textContent = error.message || 'Could not save. Please retry.';
        apply.disabled = false;
      }
    };

    dialog.append(note, equal, cancel, apply);
    dialog.querySelectorAll('button,input').forEach(element => {
      element.style.cssText += ';font:inherit;padding:9px;border-radius:10px;border:1px solid #7c3aed55;background:#22172f;color:#e3c9ff;margin:3px;touch-action:manipulation;-webkit-user-select:none;user-select:none';
    });
    dialog.addEventListener('close', () => {
      if (!committed && typeof options.cancel === 'function') options.cancel();
      dialog.remove();
    });
    document.body.append(dialog);
    sync(false);
    dialog.showModal();
  };
})(typeof window !== 'undefined' ? window : globalThis);
