/**
 * Let the browser paint and handle input between chunks of long work.
 * Unlike setTimeout(0), a MessageChannel task is not throttled in background
 * tabs, so a long import keeps going when the user switches tabs.
 */
export function yieldToMain(): Promise<void> {
  return new Promise(resolve => {
    if (typeof MessageChannel === 'undefined') {
      setTimeout(resolve, 0);
      return;
    }
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}
