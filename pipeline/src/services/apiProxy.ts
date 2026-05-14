/**
 * Secure API Proxy Helper
 *
 * All PHP API calls go through the Cloud Function `proxyApiCall`,
 * which injects credentials server-side. The frontend never sees
 * the API key or password.
 */

const PROXY_URL = 'https://asia-south1-a-square-6720c.cloudfunctions.net/proxyApiCall'

/**
 * Call the PHP API via the secure Cloud Function proxy.
 *
 * @param transac  - The transaction type (e.g. 'get_tables', 'submit_order')
 * @param params   - Additional query parameters (excluding key/pswd/transac)
 * @param options  - Optional: { method: 'POST', body: object } for POST requests
 * @returns The JSON response from the API
 */
export async function callApi(
  transac: string,
  params: Record<string, string> = {},
  options?: { method: 'POST'; body: unknown },
): Promise<unknown> {
  const payload: Record<string, unknown> = { ...params, transac }

  if (options?.method === 'POST') {
    payload.method = 'POST'
    payload.body = options.body
  }

  const response = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(`Proxy HTTP ${response.status}`)
  }

  return response.json()
}
