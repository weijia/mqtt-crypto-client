/**
 * 浏览器构建用的极简 EventEmitter，替代 Node 的 `node:events`。
 * 仅实现本库客户端实际使用的方法，避免把 events 包变成运行时依赖。
 */
export class EventEmitter {
  constructor() {
    /** @type {Map<string | symbol, Set<Function>>} */
    this._listeners = new Map();
  }

  /**
   * @param {string | symbol} event
   * @param {Function} listener
   * @returns {this}
   */
  on(event, listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('listener 必须是函数');
    }
    let listeners = this._listeners.get(event);
    if (!listeners) {
      listeners = new Set();
      this._listeners.set(event, listeners);
    }
    listeners.add(listener);
    return this;
  }

  /**
   * @param {string | symbol} event
   * @param {Function} listener
   * @returns {this}
   */
  addListener(event, listener) {
    return this.on(event, listener);
  }

  /**
   * @param {string | symbol} event
   * @param {Function} listener
   * @returns {this}
   */
  once(event, listener) {
    /** @type {((...args: any[]) => void) & { listener?: Function }} */
    const wrapper = (...args) => {
      this.off(event, wrapper);
      listener(...args);
    };
    wrapper.listener = listener;
    return this.on(event, wrapper);
  }

  /**
   * @param {string | symbol} event
   * @param {Function} listener
   * @returns {this}
   */
  off(event, listener) {
    const listeners = this._listeners.get(event);
    if (!listeners) return this;
    for (const candidate of listeners) {
      const original = /** @type {any} */ (candidate).listener;
      if (candidate === listener || original === listener) {
        listeners.delete(candidate);
      }
    }
    if (listeners.size === 0) this._listeners.delete(event);
    return this;
  }

  /**
   * @param {string | symbol} event
   * @param {Function} listener
   * @returns {this}
   */
  removeListener(event, listener) {
    return this.off(event, listener);
  }

  /**
   * @param {string | symbol} [event]
   * @returns {this}
   */
  removeAllListeners(event) {
    if (event === undefined) this._listeners.clear();
    else this._listeners.delete(event);
    return this;
  }

  /**
   * @param {string | symbol} event
   * @returns {number}
   */
  listenerCount(event) {
    return this._listeners.get(event)?.size ?? 0;
  }

  /**
   * @param {string | symbol} event
   * @param {...any} args
   * @returns {boolean}
   */
  emit(event, ...args) {
    const listeners = this._listeners.get(event);
    if (!listeners || listeners.size === 0) {
      if (event === 'error') throw args[0] instanceof Error ? args[0] : new Error(String(args[0]));
      return false;
    }
    for (const listener of [...listeners]) {
      listener(...args);
    }
    return true;
  }
}
