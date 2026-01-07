// Chat Window bridge: forwards messages between webview-ui (iframe) and main process IPC
(function () {
  const iframe = document.getElementById('chat-iframe');
  if (!iframe) return;

  const params = new URLSearchParams(window.location.search);
  const session = params.get('session') || `chat_${Date.now()}`;

  iframe.src = `../webview-ui/dist/index.html?session=${encodeURIComponent(session)}`;

  // Forward agent responses to iframe (mapped like main renderer)
  window.electronAPI?.on('agent-response', (_event, response) => {
    const mapped = mapAgentResponse(response);
    iframe.contentWindow?.postMessage(mapped, '*');
  });

  window.electronAPI?.on('llm-connection', (_event, payload) => {
    iframe.contentWindow?.postMessage({ type: 'llm_connection', data: payload }, '*');
  });

  window.electronAPI?.on('update-status', (_event, payload) => {
    iframe.contentWindow?.postMessage({ type: 'update_status', data: payload }, '*');
  });

  window.addEventListener('message', async (event) => {
    const message = event.data;
    if (!message) return;

    if (message.type === 'get_editor_context') {
      const ctx = await window.electronAPI?.getEditorState?.();
      iframe.contentWindow?.postMessage({ type: 'editor_context', data: ctx || {} }, '*');
      return;
    }

    if (message.type === 'execute_task') {
      // Forward to main; context carries taskId for correlation
      const instruction = message.data?.instruction;
      const context = message.data?.context || {};
      if (!instruction) return;
      await window.electronAPI?.executeTask(instruction, { ...context, taskId: message.data?.taskId });
      return;
    }

    if (message.type === 'cancel_task') {
      const taskId = message.data?.taskId;
      if (taskId) await window.electronAPI?.cancelTask(taskId);
      return;
    }
  });

  function mapAgentResponse(response) {
    const taskId = response?.data?.taskId;
    if (response.type === 'status') {
      return {
        type: 'status_update',
        data: { taskId, state: response.data?.state || 'thinking', message: response.data?.message || '' }
      };
    }
    if (response.type === 'done') {
      return {
        type: 'task_complete',
        data: { taskId, success: !!response.data?.success, message: response.data?.message || '', rl: response.data?.rl || null }
      };
    }
    if (response.type === 'action') {
      return {
        type: 'action_log',
        data: {
          taskId,
          actionId: response.data?.actionId || response.data?.tool || `action_${Date.now()}`,
          tool: response.data?.tool || 'action',
          input: response.data?.input || response.data || {},
          result: response.data?.result || '',
          success: true
        }
      };
    }
    return response;
  }
})();



