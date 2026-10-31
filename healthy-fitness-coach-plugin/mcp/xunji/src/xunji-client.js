'use strict';

const { randomUUID } = require('node:crypto');
const { gunzipSync } = require('node:zlib');
const { connectorError } = require('./errors.js');
const { assertDate } = require('./schemas.js');

const PRODUCTION_URL = 'https://trains.xunjiapp.cn/api_trains_for_llm_v2';
const UPSERT_URL = 'https://trains.xunjiapp.cn/api_upsert_trains_for_llm_v2';

function upsertUrlFor(baseUrl) {
  try {
    const url = new URL(baseUrl);
    url.pathname = '/api_upsert_trains_for_llm_v2';
    url.search = '';
    return url.toString();
  } catch {
    return UPSERT_URL;
  }
}

function decodeXunjiResponse(input) {
  let payload = input;
  try {
    if (Buffer.isBuffer(input)) {
      const raw = input.length >= 2 && input[0] === 0x1f && input[1] === 0x8b ? gunzipSync(input) : input;
      payload = JSON.parse(raw.toString('utf8'));
    } else if (typeof input === 'string') {
      payload = JSON.parse(input);
    }
  } catch {
    throw connectorError('invalid_response');
  }
  const successOmitted = payload && !Object.prototype.hasOwnProperty.call(payload, 'success');
  if (!payload || !(Array.isArray(payload.res) || (payload.res && Array.isArray(payload.res.trains))) || (payload.success !== true && !successOmitted)) {
    const message = String(payload && (payload.error || payload.message || payload.code || payload.res) || '').toLowerCase();
    if (/vip|会员/.test(message)) throw connectorError('membership_required');
    if (/too\s*frequent|频繁|90\s*s/.test(message)) throw connectorError('rate_limited', { retry_after_seconds: Number(payload.retry_after_ms) / 1000 || Number(message.match(/retry after (\d+)s/)?.[1]) || 15 });
    if (/apikey|api\s*key|授权/.test(message)) throw connectorError('invalid_credentials');
    throw connectorError('invalid_response');
  }
  return { records: Array.isArray(payload.res) ? payload.res : payload.res.trains, truncated: Boolean(payload.res?.truncated || payload.res?.trains?.some(t => t.truncated || t.movements?.some(m => m.truncated))) };
}

class XunjiClient {
  constructor({ fetchImpl = globalThis.fetch, baseUrl = PRODUCTION_URL, timeoutMs = 12_000 } = {}) {
    if (typeof fetchImpl !== 'function') throw connectorError('network_error');
    this.fetchImpl = fetchImpl;
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
  }

  async fetchDay(date, credential, { include_full_data = false } = {}) {
    assertDate(date);
    if (typeof credential !== 'string' || credential.length === 0) throw connectorError('missing_credentials');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.baseUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json', 'Accept-Encoding': 'gzip' },
        body: JSON.stringify({ schema_version: 'train_open_api_v2', datestr: date, include_full_data }),
        signal: controller.signal
      });
      if (response.status === 401 || response.status === 403) throw connectorError('invalid_credentials');
      if (response.status === 429) throw connectorError('rate_limited');
      if (!response.ok) throw connectorError('network_error');
      return decodeXunjiResponse(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      if (error && ['invalid_credentials', 'rate_limited', 'membership_required', 'invalid_response', 'invalid_date', 'missing_credentials'].includes(error.code)) throw error;
      throw connectorError('network_error');
    } finally {
      clearTimeout(timeout);
    }
  }

  async upsertRecords(records, credential, { client_request_id = randomUUID(), dry_run = false } = {}) {
    if (!Array.isArray(records) || records.length === 0 || records.some(r => !r || typeof r !== 'object' || Array.isArray(r))) throw connectorError('invalid_upsert');
    if (typeof credential !== 'string' || credential.length === 0) throw connectorError('missing_credentials');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(upsertUrlFor(this.baseUrl), {
        method: 'POST',
        headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json', 'Accept-Encoding': 'gzip' },
        body: JSON.stringify({ schema_version: 'train_open_api_v2', client_request_id, dry_run, include_full_data: true, res: records }),
        signal: controller.signal
      });
      if (response.status === 401 || response.status === 403) throw connectorError('invalid_credentials');
      if (response.status === 429) throw connectorError('rate_limited');
      if (!response.ok) throw connectorError('network_error');
      return decodeXunjiResponse(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      if (error && ['invalid_credentials', 'rate_limited', 'membership_required', 'invalid_response', 'invalid_upsert', 'missing_credentials'].includes(error.code)) throw error;
      throw connectorError('network_error');
    } finally {
      clearTimeout(timeout);
    }
  }
}

module.exports = { decodeXunjiResponse, PRODUCTION_URL, UPSERT_URL, XunjiClient };
