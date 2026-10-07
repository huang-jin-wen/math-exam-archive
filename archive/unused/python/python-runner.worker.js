/* 在独立线程中加载 Pyodide 和运行用户代码，避免阻塞页面。 */
const PYODIDE_BASE = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';

importScripts(PYODIDE_BASE + 'pyodide.js');

let pyodideInstance = null;

async function initialize() {
  pyodideInstance = await loadPyodide({ indexURL: PYODIDE_BASE });
  self.postMessage({ type: 'ready' });
}

initialize().catch(function (error) {
  self.postMessage({
    type: 'load-error',
    message: error && error.message ? error.message : String(error)
  });
});

self.addEventListener('message', async function (event) {
  const message = event.data || {};
  if (message.type !== 'run' || !pyodideInstance) return;

  try {
    const outputs = [];
    for (const example of message.examples) {
      let output = '';
      pyodideInstance.setStdout({
        batched: function (text) {
          output += text + '\n';
        }
      });
      pyodideInstance.setStdin({
        stdin: function () {
          return example.input || '';
        }
      });
      await pyodideInstance.runPythonAsync(message.code);
      outputs.push({
        input: example.input || '',
        output: output.trim(),
        expected: example.output
      });
    }

    self.postMessage({ type: 'result', id: message.id, outputs: outputs });
  } catch (error) {
    self.postMessage({
      type: 'run-error',
      id: message.id,
      message: error && error.message ? error.message : String(error)
    });
  }
});
