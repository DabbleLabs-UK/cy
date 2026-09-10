// Shared "jump to latest" control for the public reading views.
//
// The reading surface owns the scroll behaviour; this small helper owns the
// affordance and its visibility so Handwritten and Plain cannot drift apart.

export function createJumpToLatest(root, scroller, onJump) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'feed-jump';
  button.textContent = 'jump to latest';
  button.hidden = true;
  button.addEventListener('click', () => {
    if (typeof onJump === 'function') onJump();
    else if (scroller) scroller.scrollTop = scroller.scrollHeight;
    button.hidden = true;
  });
  root.appendChild(button);

  return {
    button,
    sync(nearLatest) {
      button.hidden = !!nearLatest;
    },
    hide() {
      button.hidden = true;
    },
    show() {
      button.hidden = false;
    },
  };
}
