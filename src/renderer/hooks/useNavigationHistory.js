import { useCallback, useEffect, useRef, useState } from 'react';
import { getBrowserLocationIdentity } from '../domain/browserLocation';

/**
 * 每个标签各自一份前进/后退历史。
 *
 * 记录方式：监听当前标签位置的语义身份（sourceId + relativePath + viewMode + image），
 * 位置变化且不是由前进/后退触发的，就压入当前标签的栈。
 * 前进/后退通过 applyLocation 让页面以 replace 方式切换位置，因此不会产生新的 URL 历史。
 *
 * @param {object} options
 * @param {string|null} options.tabId 当前标签 id；为空时视为无历史。
 * @param {object|null} options.location 当前 BrowserLocation。
 * @param {(location: object) => void} options.applyLocation 应用历史条目的回调。
 */
export function useNavigationHistory({ tabId = null, location = null, applyLocation }) {
  const stacksRef = useRef(new Map());
  const applyingRef = useRef(false);
  const [, forceRender] = useState(0);

  useEffect(() => {
    if (!tabId || !location) return;
    const stacks = stacksRef.current;
    const stack = stacks.get(tabId) || { entries: [], index: -1 };
    const identity = getBrowserLocationIdentity(location);
    const currentIdentity = stack.index >= 0
      ? getBrowserLocationIdentity(stack.entries[stack.index])
      : null;

    if (currentIdentity === identity) return;

    if (applyingRef.current) {
      applyingRef.current = false;
      const targetIndex = stack.entries.findIndex(
        (entry) => getBrowserLocationIdentity(entry) === identity
      );
      if (targetIndex >= 0) {
        stack.index = targetIndex;
        stacks.set(tabId, stack);
        forceRender((value) => value + 1);
        return;
      }
    }

    const entries = [...stack.entries.slice(0, stack.index + 1), location];
    stacks.set(tabId, { entries, index: entries.length - 1 });
    forceRender((value) => value + 1);
  }, [tabId, location]);

  const stack = tabId ? (stacksRef.current.get(tabId) || { entries: [], index: -1 }) : { entries: [], index: -1 };
  const canGoBack = stack.index > 0;
  const canGoForward = stack.index >= 0 && stack.index < stack.entries.length - 1;

  const move = useCallback((delta) => {
    if (!tabId || typeof applyLocation !== 'function') return false;
    const stacks = stacksRef.current;
    const current = stacks.get(tabId);
    if (!current) return false;
    const nextIndex = current.index + delta;
    if (nextIndex < 0 || nextIndex >= current.entries.length) return false;
    const nextLocation = current.entries[nextIndex];
    current.index = nextIndex;
    stacks.set(tabId, current);
    applyingRef.current = true;
    forceRender((value) => value + 1);
    applyLocation(nextLocation);
    return true;
  }, [applyLocation, tabId]);

  const goBack = useCallback(() => move(-1), [move]);
  const goForward = useCallback(() => move(1), [move]);

  return { canGoBack, canGoForward, goBack, goForward };
}
