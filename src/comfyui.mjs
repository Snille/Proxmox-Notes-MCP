import { randomInt, randomUUID } from 'node:crypto';

// Icon generation with ComfyUI. The server talks to ComfyUI's HTTP API (POST /prompt, GET /history,
// GET /view), so the browser never needs to reach ComfyUI itself. Either the built-in recipe
// (Qwen-Image with an optional speed LoRA, then background removal) or the user's own workflow in
// ComfyUI's API format with placeholders is sent. The images come back as PNG; the browser draws
// the icon from the one the user picks, as it does for an upload.

const badRequest = message => Object.assign(new Error(message), { statusCode: 400 });
const upstreamError = message => Object.assign(new Error(message), { statusCode: 502 });

const PLACEHOLDER_NUMBERS = ['seed', 'width', 'height', 'count'];
const MAX_IMAGE_BYTES = 16_000_000;
const JOB_TTL_MS = 30 * 60_000;
const MAX_JOBS = 20;
const POLL_MS = 1500;
// The loaders whose model lists the recipe needs, and the option that names each model.
const MODEL_LOADERS = [
  { option: 'unet', node: 'UNETLoader', input: 'unet_name' },
  { option: 'lora', node: 'LoraLoaderModelOnly', input: 'lora_name' },
  { option: 'clip', node: 'CLIPLoader', input: 'clip_name' },
  { option: 'vae', node: 'VAELoader', input: 'vae_name' }
];

// ---------- prompts and workflows ----------

// The style's template with the subject in place of {{subject}}. A full stop the subject ends with
// is dropped, because the templates put their own punctuation after it.
export function stylePrompt(style, subject) {
  const text = String(subject ?? '').trim().replace(/[.\s]+$/, '');
  if (!text) throw badRequest('Describe what the icon should show');
  return style.prompt.replaceAll('{{subject}}', text);
}

/** The built-in recipe as a ComfyUI API workflow. `models` holds the names as the host lists them. */
export function recipeWorkflow(recipe, { prompt, seed, count, models }) {
  const graph = {
    unet: { class_type: 'UNETLoader', inputs: { unet_name: models.unet, weight_dtype: 'default' } },
    clip: { class_type: 'CLIPLoader', inputs: { clip_name: models.clip, type: 'qwen_image' } },
    vae: { class_type: 'VAELoader', inputs: { vae_name: models.vae } }
  };
  let model = ['unet', 0];
  if (models.lora) {
    graph.lora = { class_type: 'LoraLoaderModelOnly', inputs: { model, lora_name: models.lora, strength_model: recipe.loraStrength } };
    model = ['lora', 0];
  }
  Object.assign(graph, {
    sampling: { class_type: 'ModelSamplingAuraFlow', inputs: { model, shift: recipe.shift } },
    positive: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['clip', 0] } },
    negative: { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['positive', 0] } },
    latent: { class_type: 'EmptySD3LatentImage', inputs: { width: recipe.width, height: recipe.height, batch_size: count } },
    sampler: {
      class_type: 'KSampler',
      inputs: {
        model: ['sampling', 0], seed, steps: recipe.steps, cfg: recipe.cfg, sampler_name: recipe.sampler, scheduler: recipe.scheduler,
        positive: ['positive', 0], negative: ['negative', 0], latent_image: ['latent', 0], denoise: 1
      }
    },
    decode: { class_type: 'VAEDecode', inputs: { samples: ['sampler', 0], vae: ['vae', 0] } }
  });
  let image = ['decode', 0];
  if (recipe.removeBackground) {
    graph.background = {
      class_type: 'RMBG',
      inputs: { image, model: recipe.removeBackground, sensitivity: 1, process_res: 1024, mask_blur: 0, mask_offset: 0, invert_output: false, refine_foreground: false, background: 'Alpha' }
    };
    image = ['background', 0];
  }
  // PreviewImage keeps the results in ComfyUI's temp folder instead of its output folder.
  graph.result = { class_type: 'PreviewImage', inputs: { images: image } };
  return graph;
}

/** Parses a workflow pasted by the user and checks that it is ComfyUI's API format. */
export function parseWorkflow(text) {
  let workflow;
  try {
    workflow = JSON.parse(text);
  } catch {
    throw badRequest('The workflow is not valid JSON');
  }
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) throw badRequest('The workflow must be a JSON object');
  if (Array.isArray(workflow.nodes)) {
    throw badRequest('This is the workflow as ComfyUI saves it for its editor. Export it with "Export (API)" instead.');
  }
  const nodes = Object.values(workflow);
  if (!nodes.length || nodes.some(node => !node || typeof node.class_type !== 'string' || typeof node.inputs !== 'object')) {
    throw badRequest('Every entry in an API workflow needs a class_type and inputs');
  }
  if (!text.includes('{{prompt}}')) throw badRequest('The workflow must contain {{prompt}} where the prompt goes');
  return workflow;
}

/** The user's workflow with the placeholders filled in. "{{seed}}" and the other numbers become numbers. */
export function fillWorkflow(workflow, values) {
  const fill = value => {
    if (typeof value === 'string') {
      const whole = value.match(/^\{\{(\w+)\}\}$/);
      if (whole && PLACEHOLDER_NUMBERS.includes(whole[1])) return values[whole[1]];
      return value.replaceAll('{{prompt}}', values.prompt);
    }
    if (Array.isArray(value)) return value.map(fill);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fill(item)]));
    return value;
  };
  return fill(workflow);
}

/**
 * Finds a model in a host's list. A name without folders matches a listed name in any folder, so
 * "qwen_image_vae.safetensors" finds "Qwen\qwen_image_vae.safetensors"; case does not matter.
 */
export function resolveModel(available, wanted) {
  if (!wanted) return null;
  if (available.includes(wanted)) return wanted;
  const base = name => name.split(/[\\/]/).pop().toLowerCase();
  const target = base(wanted);
  return available.find(name => name.toLowerCase() === wanted.toLowerCase())
    ?? available.find(name => base(name) === target)
    ?? null;
}

// ---------- the ComfyUI client ----------

export class ComfyClient {
  constructor(baseUrl, { timeoutMs = 15_000 } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
  }

  async request(path, { method = 'GET', body, timeoutMs = this.timeoutMs, raw = false } = {}) {
    let response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      throw upstreamError(`ComfyUI at ${this.baseUrl} did not answer (${error.cause?.code ?? error.name})`);
    }
    if (raw) {
      if (!response.ok) throw upstreamError(`ComfyUI returned ${response.status} for ${path.split('?')[0]}`);
      return response;
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw upstreamError(promptError(data) ?? `ComfyUI returned ${response.status} for ${path}`);
    }
    return data;
  }

  systemStats(timeoutMs = 4000) {
    return this.request('/system_stats', { timeoutMs });
  }

  queue() {
    return this.request('/queue');
  }

  async objectInfo(node) {
    return (await this.request(`/object_info/${encodeURIComponent(node)}`))?.[node] ?? null;
  }

  async submit(workflow) {
    return (await this.request('/prompt', { method: 'POST', body: { prompt: workflow, client_id: 'proxmox-notes' } })).prompt_id;
  }

  async history(promptId) {
    return (await this.request(`/history/${encodeURIComponent(promptId)}`))?.[promptId] ?? null;
  }

  async view({ filename, subfolder = '', type = 'output' }) {
    const query = new URLSearchParams({ filename, subfolder, type });
    const response = await this.request(`/view?${query}`, { raw: true, timeoutMs: 60_000 });
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length > MAX_IMAGE_BYTES) throw upstreamError('ComfyUI returned an image larger than 16 MB');
    return data;
  }
}

// A readable message from ComfyUI's answer to a refused prompt: its error plus the node errors.
function promptError(data) {
  if (!data?.error) return null;
  const main = data.error.message ?? String(data.error);
  const nodes = Object.values(data.node_errors ?? {}).flatMap(node =>
    (node.errors ?? []).map(error => `${node.class_type}: ${error.details || error.message}`));
  return [main, ...nodes].join('; ');
}

// ---------- jobs ----------

/** Runs generations in the background; the browser polls a job until its images are ready. */
export class Generator {
  constructor({ options, now = () => Date.now(), pollMs = POLL_MS }) {
    this.options = options;
    this.now = now;
    this.pollMs = pollMs;
    this.jobs = new Map();
    this.models = new Map();
  }

  settings() {
    return this.options.get().generator;
  }

  /** The first host that answers, or the requested one. */
  async pickHost(requested) {
    const { hosts } = this.settings();
    if (!hosts.length) throw badRequest('No ComfyUI host is set. Add one under Settings → Image generator.');
    if (requested) {
      if (!hosts.includes(requested)) throw badRequest('That ComfyUI host is not in the settings');
      return new ComfyClient(requested);
    }
    const failures = [];
    for (const url of hosts) {
      const client = new ComfyClient(url);
      try {
        await client.systemStats();
        return client;
      } catch (error) {
        failures.push(error.message);
      }
    }
    throw upstreamError(`No ComfyUI host answered: ${failures.join('; ')}`);
  }

  /** The recipe's model names as this host lists them. Lists are kept for five minutes. */
  async resolveModels(client, recipe) {
    const cached = this.models.get(client.baseUrl);
    let lists = cached && this.now() - cached.at < 5 * 60_000 ? cached.lists : null;
    if (!lists) {
      lists = {};
      for (const loader of MODEL_LOADERS) {
        const info = await client.objectInfo(loader.node);
        const options = info?.input?.required?.[loader.input];
        lists[loader.option] = Array.isArray(options?.[0]) ? options[0] : options?.[1]?.options ?? [];
      }
      const rmbg = await client.objectInfo('RMBG');
      lists.background = rmbg?.input?.required?.model?.[0] ?? null;
      this.models.set(client.baseUrl, { at: this.now(), lists });
    }
    const models = {};
    const missing = [];
    for (const loader of MODEL_LOADERS) {
      models[loader.option] = resolveModel(lists[loader.option], recipe[loader.option]);
      if (recipe[loader.option] && !models[loader.option]) missing.push(recipe[loader.option]);
    }
    if (recipe.removeBackground && !lists.background?.includes(recipe.removeBackground)) {
      missing.push(lists.background ? `background model ${recipe.removeBackground}` : 'the RMBG node (ComfyUI-RMBG)');
    }
    return { models, missing };
  }

  /** Checks each host (given in the request, so unsaved settings can be tested). */
  async test(generator) {
    const results = [];
    for (const url of generator.hosts ?? []) {
      const client = new ComfyClient(url);
      const result = { url, ok: false };
      try {
        const stats = await client.systemStats();
        const device = stats?.devices?.[0];
        result.version = stats?.system?.comfyui_version ?? null;
        result.device = device ? `${device.name.replace(/^cuda:\d+\s*/, '').replace(/\s*:\s*\w+$/, '')}, ${(device.vram_free / 1e9).toFixed(1)} GB free` : null;
        if (generator.mode === 'workflow') {
          parseWorkflow(generator.workflow ?? '');
          result.ok = true;
        } else {
          this.models.delete(client.baseUrl);
          const { models, missing } = await this.resolveModels(client, generator.recipe);
          result.models = models;
          result.missing = missing;
          result.ok = missing.length === 0;
        }
      } catch (error) {
        result.error = error.message;
      }
      results.push(result);
    }
    return { results };
  }

  async start({ subject, style: styleName, count, host } = {}) {
    const settings = this.settings();
    const style = settings.styles.find(item => item.name === styleName) ?? settings.styles[0];
    if (!style) throw badRequest('Add a style under Settings → Image generator first');
    const prompt = stylePrompt(style, subject);
    const images = Math.min(Math.max(Number(count) || settings.count, 1), 4);
    const seed = randomInt(1, 2 ** 47);
    const client = await this.pickHost(host);
    let workflow;
    if (settings.mode === 'workflow') {
      const { width, height } = settings.recipe;
      workflow = fillWorkflow(parseWorkflow(settings.workflow), { prompt, seed, width, height, count: images });
    } else {
      const { models, missing } = await this.resolveModels(client, settings.recipe);
      if (missing.length) throw badRequest(`ComfyUI at ${client.baseUrl} lacks: ${missing.join(', ')}`);
      workflow = recipeWorkflow(settings.recipe, { prompt, seed, count: images, models });
    }
    const promptId = await client.submit(workflow);
    const job = {
      id: randomUUID(),
      state: 'queued',
      host: client.baseUrl,
      style: style.name,
      labelSuffix: style.labelSuffix,
      subject: String(subject).trim(),
      prompt,
      seed,
      count: images,
      startedAt: this.now(),
      promptId,
      images: [],
      error: null
    };
    this.prune();
    this.jobs.set(job.id, job);
    this.follow(job, client);
    return this.publicJob(job);
  }

  // Polls ComfyUI until the prompt is done, then fetches its images.
  async follow(job, client) {
    const timeoutMs = this.settings().timeoutSeconds * 1000;
    try {
      while (true) {
        const entry = await client.history(job.promptId);
        if (entry?.status?.completed || entry?.status?.status_str === 'error') {
          if (entry.status.status_str === 'error') {
            const failed = entry.status.messages?.find(([kind]) => kind === 'execution_error')?.[1];
            throw upstreamError(failed ? `${failed.node_type}: ${failed.exception_message}` : 'ComfyUI reported an error');
          }
          const files = Object.values(entry.outputs ?? {}).flatMap(output => output.images ?? []);
          if (!files.length) throw upstreamError('The workflow finished without images');
          for (const file of files) job.images.push(await client.view(file));
          job.state = 'done';
          return;
        }
        const queue = await client.queue().catch(() => null);
        if (queue?.queue_running?.some(item => item[1] === job.promptId)) job.state = 'running';
        if (this.now() - job.startedAt > timeoutMs) throw upstreamError(`No result after ${timeoutMs / 1000} seconds`);
        await new Promise(resolve => setTimeout(resolve, this.pollMs));
      }
    } catch (error) {
      job.state = 'error';
      job.error = error.message;
    } finally {
      job.finishedAt = this.now();
    }
  }

  get(id) {
    const job = this.jobs.get(id);
    if (!job) throw Object.assign(new Error('Unknown or expired generation'), { statusCode: 404 });
    return job;
  }

  image(id, index) {
    const data = this.get(id).images[index];
    if (!data) throw Object.assign(new Error('No such image'), { statusCode: 404 });
    return data;
  }

  publicJob(job) {
    const { promptId, images, ...rest } = job;
    return {
      ...rest,
      elapsedMs: (job.finishedAt ?? this.now()) - job.startedAt,
      images: images.map((_, index) => `/api/generate/${job.id}/${index}.png`)
    };
  }

  // Finished jobs are kept for 30 minutes, and never more than MAX_JOBS.
  prune() {
    for (const [id, job] of this.jobs) {
      if (job.finishedAt && this.now() - job.finishedAt > JOB_TTL_MS) this.jobs.delete(id);
    }
    while (this.jobs.size >= MAX_JOBS) this.jobs.delete(this.jobs.keys().next().value);
  }
}
