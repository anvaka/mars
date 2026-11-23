/**
 * Directive that calls bound function when user clicks outside of the element:
 *
 *   <div v-click-outside='hide'></div>
 */
const nodeList = new Map();

let startClick;

document.addEventListener('mousedown', e => (startClick = e));
document.addEventListener('mouseup', notifyNodes);

// Also hide when tapped outside.
document.addEventListener('touchstart', e => (startClick = e));
document.addEventListener('touchend', notifyNodes);

function notifyNodes(endClick) {
  nodeList.forEach((callback, el) => {
    // Click is "outside" only when it both started and ended outside:
    if (!startClick || !endClick.target || !startClick.target) return;
    if (el.contains(endClick.target) || el.contains(startClick.target)) return;

    if (typeof callback === 'function') callback();
  });
}

export default {
  mounted(el, binding) {
    nodeList.set(el, binding.value);
  },

  updated(el, binding) {
    nodeList.set(el, binding.value);
  },

  unmounted(el) {
    nodeList.delete(el);
  }
};
