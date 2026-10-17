const $ = id => document.getElementById(id);

async function call(tool, args) {
  const response = await fetch(`/api/tools/${tool}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(args)
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? response.statusText);
  }
  return body;
}

call('notes_status', {})
  .then(s => { $('status').textContent = `v${s.version} · options: ${s.optionsSource}`; })
  .catch(e => { $('status').textContent = `not reachable: ${e.message}`; });

$('parse').addEventListener('click', async () => {
  const summary = $('summary');
  summary.className = '';
  try {
    const result = await call('notes_parse', { markdown: $('markdown').value });
    $('result').textContent = JSON.stringify(result, null, 2);
    if (!result.ok) {
      summary.className = 'bad';
      summary.textContent = `Not in the Notes format (line ${result.line}): ${result.error}`;
      return;
    }
    const again = await call('notes_render', { doc: result.doc });
    summary.className = again.fits ? 'ok' : 'bad';
    summary.textContent = `Read ${result.doc.sections.length} sections. Rendered again: ${again.length} of ${again.limit} characters.`;
  } catch (error) {
    summary.className = 'bad';
    summary.textContent = error.message;
  }
});
