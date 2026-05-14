// Toast event bus. The visible <ToastContainer /> subscribes to these events.
// Kept in a JS file (no JSX) so react-refresh stays happy.

let listeners = [];
let nextId = 1;

const emit = (toast) => {
  listeners.forEach((fn) => fn(toast));
};

export const toast = {
  show: (message, { type = 'info', duration = 4000 } = {}) => {
    const id = nextId++;
    emit({ id, message, type, duration, action: 'add' });
    return id;
  },
  success: (message, opts) => toast.show(message, { ...opts, type: 'success' }),
  error: (message, opts) =>
    toast.show(message, { ...opts, type: 'error', duration: opts?.duration ?? 5500 }),
  info: (message, opts) => toast.show(message, { ...opts, type: 'info' }),
  dismiss: (id) => emit({ id, action: 'remove' }),
};

export function subscribeToast(handler) {
  listeners.push(handler);
  return () => {
    listeners = listeners.filter((fn) => fn !== handler);
  };
}
