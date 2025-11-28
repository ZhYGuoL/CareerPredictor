// Minimal test worker
export default {
  async fetch(request: Request): Promise<Response> {
    console.log('TEST: Request received', request.method, request.url)
    return new Response(JSON.stringify({ test: 'ok' }), {
      headers: { 'Content-Type': 'application/json' }
    })
  }
}

