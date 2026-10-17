import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fillWorkflow, Generator, parseWorkflow, recipeWorkflow, resolveModel, stylePrompt } from '../src/comfyui.mjs';
import { loadSettings } from '../src/config.mjs';
import { IconStore } from '../src/icons.mjs';
import { OptionsStore, withDefaults } from '../src/options.mjs';
import { Proxmox } from '../src/proxmox/index.mjs';
import { createNotesServer } from '../src/server.mjs';
import { SnapshotStore } from '../src/snapshots.mjs';
import { buildTools } from '../src/tools.mjs';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');

const servers = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))));
});

async function listen(server) {
  servers.push(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

// A small stand-in for ComfyUI: model lists, a prompt endpoint that records the workflow, a history
// that is complete on the second look, and /view.
async function fakeComfy({ fail = null } = {}) {
  const state = { submitted: [], looks: 0 };
  const lists = {
    UNETLoader: { unet_name: ['Qwen\\qwen_image_2512_fp8_e4m3fn.safetensors'] },
    LoraLoaderModelOnly: { lora_name: ['Qwen\\improvments\\Wuli-Qwen-Image-2512-Turbo-LoRA-4steps-V1.0-bf16_ComfyUi.safetensors'] },
    CLIPLoader: { clip_name: ['qwen_2.5_vl_7b_fp8_scaled.safetensors'] },
    VAELoader: { vae_name: ['Qwen\\qwen_image_vae.safetensors'] },
    RMBG: { model: ['RMBG-2.0', 'BEN2'] }
  };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.pathname === '/system_stats') return json(200, { system: { comfyui_version: '0.41.3' }, devices: [{ name: 'cuda:0 Test GPU : cuda', vram_free: 8e9 }] });
    const info = url.pathname.match(/^\/object_info\/(\w+)$/);
    if (info) {
      const inputs = lists[info[1]];
      return json(200, inputs ? { [info[1]]: { input: { required: Object.fromEntries(Object.entries(inputs).map(([key, list]) => [key, [list]])) } } } : {});
    }
    if (url.pathname === '/prompt' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      state.submitted.push(JSON.parse(body).prompt);
      return json(200, { prompt_id: 'p1' });
    }
    if (url.pathname === '/queue') return json(200, { queue_running: [[0, 'p1']], queue_pending: [] });
    if (url.pathname === '/history/p1') {
      state.looks += 1;
      if (state.looks < 2) return json(200, {});
      if (fail) return json(200, { p1: { status: { status_str: 'error', completed: false, messages: [['execution_error', { node_type: 'KSampler', exception_message: fail }]] }, outputs: {} } });
      return json(200, { p1: { status: { status_str: 'success', completed: true }, outputs: { result: { images: [{ filename: 'a.png', subfolder: '', type: 'temp' }, { filename: 'b.png', subfolder: '', type: 'temp' }] } } } });
    }
    if (url.pathname === '/view') {
      res.writeHead(200, { 'content-type': 'image/png' });
      return res.end(PNG);
    }
    json(404, {});
  });
  return { url: await listen(server), state };
}

function generatorFor(generator) {
  const options = withDefaults({ generator });
  return new Generator({ options: { get: () => options }, pollMs: 5 });
}

async function finished(generator, id) {
  for (let i = 0; i < 200; i++) {
    const job = generator.get(id);
    if (job.state === 'done' || job.state === 'error') return job;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('the job did not finish');
}

describe('prompts and workflows', () => {
  it('puts the subject in the style prompt without a doubled full stop', () => {
    const style = { prompt: 'An icon with a {{subject}}. Outside is emptiness.' };
    expect(stylePrompt(style, ' big drop of water. ')).toBe('An icon with a big drop of water. Outside is emptiness.');
    expect(() => stylePrompt(style, '  ')).toThrow(/Describe/);
  });

  it('finds models by name in any folder, ignoring case', () => {
    const list = ['Qwen\\qwen_image_vae.safetensors', 'other/Model.safetensors'];
    expect(resolveModel(list, 'qwen_image_vae.safetensors')).toBe('Qwen\\qwen_image_vae.safetensors');
    expect(resolveModel(list, 'model.safetensors')).toBe('other/Model.safetensors');
    expect(resolveModel(list, 'Qwen\\Qwen_Image_Vae.safetensors')).toBe('Qwen\\qwen_image_vae.safetensors');
    expect(resolveModel(list, 'missing.safetensors')).toBeNull();
    expect(resolveModel(list, '')).toBeNull();
  });

  it('builds the recipe with or without the LoRA and the background removal', () => {
    const recipe = withDefaults({}).generator.recipe;
    const models = { unet: 'u', lora: 'l', clip: 'c', vae: 'v' };
    const full = recipeWorkflow(recipe, { prompt: 'p', seed: 7, count: 3, models });
    expect(full.lora.inputs.lora_name).toBe('l');
    expect(full.sampling.inputs.model).toEqual(['lora', 0]);
    expect(full.latent.inputs).toEqual({ width: 1328, height: 1328, batch_size: 3 });
    expect(full.sampler.inputs).toMatchObject({ seed: 7, steps: 4, cfg: 1, sampler_name: 'euler', scheduler: 'simple' });
    expect(full.background.inputs).toMatchObject({ model: 'RMBG-2.0', background: 'Alpha', image: ['decode', 0] });
    expect(full.result).toEqual({ class_type: 'PreviewImage', inputs: { images: ['background', 0] } });

    const plain = recipeWorkflow({ ...recipe, removeBackground: '' }, { prompt: 'p', seed: 7, count: 1, models: { ...models, lora: null } });
    expect(plain.lora).toBeUndefined();
    expect(plain.background).toBeUndefined();
    expect(plain.sampling.inputs.model).toEqual(['unet', 0]);
    expect(plain.result.inputs.images).toEqual(['decode', 0]);
  });

  it('checks a pasted workflow and fills in its placeholders', () => {
    expect(() => parseWorkflow('{"nodes": [], "links": []}')).toThrow(/Export \(API\)/);
    expect(() => parseWorkflow('not json')).toThrow(/valid JSON/);
    expect(() => parseWorkflow('{"1": {"class_type": "X", "inputs": {}}}')).toThrow(/\{\{prompt\}\}/);
    const workflow = parseWorkflow(JSON.stringify({
      1: { class_type: 'CLIPTextEncode', inputs: { text: 'Style: {{prompt}}' } },
      2: { class_type: 'KSampler', inputs: { seed: '{{seed}}', other: ['1', 0] } },
      3: { class_type: 'EmptyLatentImage', inputs: { width: '{{width}}', height: '{{height}}', batch_size: '{{count}}' } }
    }));
    const filled = fillWorkflow(workflow, { prompt: 'a "quoted" lamp', seed: 42, width: 512, height: 768, count: 2 });
    expect(filled[1].inputs.text).toBe('Style: a "quoted" lamp');
    expect(filled[2].inputs).toEqual({ seed: 42, other: ['1', 0] });
    expect(filled[3].inputs).toEqual({ width: 512, height: 768, batch_size: 2 });
  });
});

describe('generation against ComfyUI', () => {
  it('tests hosts and reports models and what is missing', async () => {
    const comfy = await fakeComfy();
    const generator = generatorFor({ hosts: [comfy.url] });
    const ok = await generator.test(withDefaults({ generator: { hosts: [comfy.url, 'http://127.0.0.1:1'] } }).generator);
    expect(ok.results[0]).toMatchObject({ ok: true, version: '0.41.3', device: 'Test GPU, 8.0 GB free', missing: [] });
    expect(ok.results[0].models.unet).toBe('Qwen\\qwen_image_2512_fp8_e4m3fn.safetensors');
    expect(ok.results[1].ok).toBe(false);
    expect(ok.results[1].error).toMatch(/did not answer/);

    const missing = await generator.test(withDefaults({ generator: { hosts: [comfy.url], recipe: { unet: 'flux.safetensors', removeBackground: 'INSPYRENET' } } }).generator);
    expect(missing.results[0].ok).toBe(false);
    expect(missing.results[0].missing).toEqual(['flux.safetensors', 'background model INSPYRENET']);
  });

  it('runs the recipe on the first host that answers and returns the images', async () => {
    const comfy = await fakeComfy();
    const generator = generatorFor({ hosts: ['http://127.0.0.1:1', comfy.url] });
    const started = await generator.start({ subject: 'drop of water', style: 'Green', count: 2 });
    expect(started).toMatchObject({ state: 'queued', host: comfy.url, style: 'Green', labelSuffix: ' (green)', count: 2 });
    expect(started.prompt).toContain('green metallic frame, inside the frame is a drop of water. Outside');
    const job = await finished(generator, started.id);
    expect(job.state).toBe('done');
    expect(generator.publicJob(job).images).toEqual([`/api/generate/${job.id}/0.png`, `/api/generate/${job.id}/1.png`]);
    expect(generator.image(job.id, 1)).toEqual(PNG);
    const sent = comfy.state.submitted[0];
    expect(sent.unet.inputs.unet_name).toBe('Qwen\\qwen_image_2512_fp8_e4m3fn.safetensors');
    expect(sent.positive.inputs.text).toBe(started.prompt);
    expect(sent.sampler.inputs.seed).toBe(started.seed);
    expect(sent.latent.inputs.batch_size).toBe(2);
  });

  it('sends an own workflow and reports a ComfyUI error', async () => {
    const comfy = await fakeComfy({ fail: 'out of memory' });
    const workflow = JSON.stringify({ 1: { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}' } }, 2: { class_type: 'KSampler', inputs: { seed: '{{seed}}' } } });
    const generator = generatorFor({ hosts: [comfy.url], mode: 'workflow', workflow });
    const started = await generator.start({ subject: 'lamp' });
    expect(comfy.state.submitted[0][2].inputs.seed).toBe(started.seed);
    const job = await finished(generator, started.id);
    expect(job).toMatchObject({ state: 'error', error: 'KSampler: out of memory' });
  });

  it('refuses to start without hosts, with an unknown host, or without a subject', async () => {
    await expect(generatorFor({}).start({ subject: 'x' })).rejects.toThrow(/No ComfyUI host/);
    await expect(generatorFor({ hosts: ['http://127.0.0.1:1'] }).start({ subject: 'x', host: 'http://192.0.2.1:8188' })).rejects.toThrow(/not in the settings/);
    await expect(generatorFor({ hosts: ['http://127.0.0.1:1'] }).start({ subject: '' })).rejects.toThrow(/Describe/);
  });
});

describe('generator over HTTP', () => {
  it('starts a job, polls it, serves the PNG and validates a test request', async () => {
    const comfy = await fakeComfy();
    const dataDir = await mkdtemp(join(tmpdir(), 'proxmox-notes-'));
    const options = await OptionsStore.open(dataDir);
    await options.save({ ...options.get(), generator: { ...options.get().generator, hosts: [comfy.url] } });
    const proxmox = await Proxmox.open(join(dataDir, 'targets.json'));
    const icons = await IconStore.open(dataDir);
    const generator = new Generator({ options, pollMs: 5 });
    const server = createNotesServer({
      settings: loadSettings({ DATA_DIR: dataDir }), options, proxmox, icons, generator,
      tools: buildTools({ options, proxmox, icons, snapshots: new SnapshotStore(dataDir) })
    });
    const base = await listen(server);
    const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

    const { job } = await (await post('/api/generate', { subject: 'whale with servers' })).json();
    await finished(generator, job.id);
    const polled = (await (await fetch(`${base}/api/generate/${job.id}`)).json()).job;
    expect(polled.state).toBe('done');
    expect(polled.promptId).toBeUndefined();
    const image = await fetch(`${base}${polled.images[0]}`);
    expect(image.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await image.arrayBuffer())).toEqual(PNG);
    expect((await fetch(`${base}/api/generate/${job.id}/9.png`)).status).toBe(404);
    expect((await fetch(`${base}/api/generate/00000000-0000-0000-0000-000000000000`)).status).toBe(404);

    expect((await post('/api/generator/test', { hosts: ['ftp://example.com'] })).status).toBe(400);
    expect((await (await post('/api/generator/test', { hosts: [comfy.url] })).json()).results[0].ok).toBe(true);
  });

  it('keeps how a generated icon was made in the library', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'proxmox-notes-'));
    const icons = await IconStore.open(dataDir);
    const webp = Buffer.from('52494646000000005745425056503820', 'hex').toString('base64');
    const icon = await icons.add({ label: 'Prowlarr (green)', webp, generation: { subject: 'radar', style: 'Green', prompt: 'p', seed: 42 } });
    expect(icon.generation).toEqual({ subject: 'radar', style: 'Green', prompt: 'p', seed: 42 });
  });
});
