// Declares a client's functions to a CLI as real MCP tools, so the model calls them natively instead of imitating a
// call in text. It executes nothing: the bridge reads the call from the CLI's event stream and stops the CLI before a
// result is needed; the client runs the function and sends the result in its next request. A call that does arrive is
// refused; with a capture file (argv[3], used for agy, whose events shorten long arguments) its name and full arguments
// are first appended there for the bridge. Node built-ins only; one JSON-RPC message per line on stdio.
import { appendFileSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const tools = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const capture = process.argv[3];
const send = message => process.stdout.write(JSON.stringify({ jsonrpc:'2.0', ...message }) + '\n');

createInterface({ input:process.stdin }).on('line', line => {
  let request;
  try { request = JSON.parse(line); } catch { return send({ id:null, error:{ code:-32700, message:'Parse error' } }); }
  const { id, method, params } = request;
  if (id === undefined) return; // notification
  if (method === 'initialize') return send({ id, result:{ protocolVersion:params?.protocolVersion || '2025-06-18', capabilities:{ tools:{} }, serverInfo:{ name:'openbridge', version:'1' } } });
  if (method === 'ping') return send({ id, result:{} });
  if (method === 'tools/list') return send({ id, result:{ tools } });
  if (method === 'tools/call') {
    if (capture) appendFileSync(capture, JSON.stringify({ name:params?.name, arguments:params?.arguments ?? {} }) + '\n');
    return send({ id, result:{ isError:true, content:[{ type:'text', text:'Not executed: the client application runs this function.' }] } });
  }
  send({ id, error:{ code:-32601, message:`Method not found: ${method}` } });
});
