// One decorative pill per active visual row; outgoing rows exist only while fading.
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const forcedColors = matchMedia('(forced-colors: active)');
const duration = 180;
const slideEasing = 'cubic-bezier(.22,.75,.26,1)';
const sameRow = (a, b) => Math.abs(a.y - b.y) < 1;
const sameBounds = (a, b) => ['x', 'y', 'width', 'height'].every(key => Math.abs(a[key] - b[key]) < .25);

export function selectionPill(track) {
  let selected = null;
  let active = null;
  const outgoing = new Set();

  function bounds(element) {
    const base = track.getBoundingClientRect();
    const {left, top, width, height} = element.getBoundingClientRect();
    return {x:left - base.left - track.clientLeft, y:top - base.top - track.clientTop, width, height};
  }

  function remove(layer) {
    layer.animation?.cancel();
    layer.node.remove();
    outgoing.delete(layer);
  }

  function rest(layer, geometry) {
    layer.geometry = geometry;
    const {x, y, width, height} = geometry;
    Object.assign(layer.node.style, {left:`${x}px`, top:`${y}px`, width:`${width}px`, height:`${height}px`});
  }

  function fadeOut(layer) {
    const opacity = getComputedStyle(layer.node).opacity;
    layer.animation?.cancel();
    // An interrupted slide fades at its current position, rather than jumping to its target.
    const animation = layer.node.animate([{opacity}, {opacity:0}], {duration, easing:'ease-out', fill:'forwards'});
    layer.animation = animation;
    outgoing.add(layer);
    animation.onfinish = () => { if (layer.animation === animation) remove(layer); };
  }

  function sync(target, animate = true) {
    selected = target;
    const geometry = target && bounds(target);
    if (!geometry?.width || !geometry.height) {
      if (active) remove(active);
      active = null;
      outgoing.forEach(remove);
      delete track.dataset.selectionReady;
      return;
    }
    const ready = track.hasAttribute('data-selection-ready');
    const play = animate && ready && !motion.matches && !forcedColors.matches && typeof track.animate === 'function' &&
      getComputedStyle(track).visibility === 'visible' && !track.closest('[inert], [hidden]');
    if (active && sameBounds(active.geometry, geometry) && animate) return;
    if (!play) {
      outgoing.forEach(remove);
    } else if (active && !sameRow(active.geometry, geometry)) {
      const frame = bounds(active.node);
      const opacity = getComputedStyle(active.node).opacity;
      active.animation?.cancel();
      rest(active, frame);
      active.node.style.opacity = opacity;
      fadeOut(active);
      active = null;
    }
    let layer = active;
    if (!layer && play) {
      // Reversing a cross-row fade reuses the old row at its current opacity.
      layer = [...outgoing].find(item => sameBounds(item.geometry, geometry));
      if (layer) outgoing.delete(layer);
    }
    const previous = play && layer ? bounds(layer.node) : null;
    const opacity = play && layer ? Number(getComputedStyle(layer.node).opacity) : 0;
    if (!layer) {
      const node = document.createElement('i');
      node.className = 'workspace-selection-pill';
      node.setAttribute('aria-hidden', 'true');
      track.prepend(node);
      layer = {node};
    }
    layer.animation?.cancel();
    layer.node.style.opacity = '';
    rest(layer, geometry);
    active = layer;
    track.dataset.selectionReady = '';
    if (!play) return;
    if (previous && !sameBounds(previous, geometry)) {
      const x = previous.x - geometry.x;
      const y = previous.y - geometry.y;
      const width = previous.width / geometry.width;
      const height = previous.height / geometry.height;
      // Stretch horizontally by at most five percent, then settle precisely on the option.
      const stretch = Math.min(.05, Math.abs(x) / 1200);
      layer.animation = layer.node.animate([
        {transform:`translate(${x}px, ${y}px) scale(${width}, ${height})`, opacity, easing:slideEasing},
        {transform:`translate(${x * .42}px, ${y * .42}px) scale(${1 + stretch}, 1)`, opacity:Math.min(1, opacity + .75), offset:.42, easing:slideEasing},
        {transform:'none', opacity:1},
      ], {duration});
    } else if (opacity < 1) {
      layer.animation = layer.node.animate([{opacity}, {opacity:1}], {duration, easing:'ease-out'});
    }
  }

  function align() {
    if (!selected) return;
    const geometry = bounds(selected);
    // Do not interrupt an in-flight selection if layout itself didn't change.
    if (!active || !sameBounds(active.geometry, geometry)) sync(selected, false);
  }

  const resize = new ResizeObserver(align);
  resize.observe(track);
  track.classList.add('workspace-selection-track');
  const resetMotion = () => sync(selected, false);
  motion.addEventListener('change', resetMotion);
  forcedColors.addEventListener('change', resetMotion);
  return {
    set: sync,
    destroy() {
      resize.disconnect();
      motion.removeEventListener('change', resetMotion);
      forcedColors.removeEventListener('change', resetMotion);
      sync(null);
      track.classList.remove('workspace-selection-track');
    },
  };
}
