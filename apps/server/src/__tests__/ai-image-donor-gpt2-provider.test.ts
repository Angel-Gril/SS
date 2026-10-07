import sharp from 'sharp';
import {describe,expect,it,vi} from 'vitest';
import {createDonorGptImage2EditProvider,createOpenAiImageEditProvider,type OpenAiImageEditRequest} from '../services/ai-image-providers.js';

async function request():Promise<OpenAiImageEditRequest>{return {operation:'IMAGE_TO_IMAGE',prompt:'Replace the background; preserve the product.',negativePrompt:null,
  width:1008,height:1344,model:'gpt-image-2',mask:null,images:[{buffer:await sharp({create:{width:512,height:512,channels:3,background:'red'}}).png().toBuffer(),mimeType:'image/png'}]};}
function provider(fetch:any){return createDonorGptImage2EditProvider({baseUrl:'https://quality.fixture.example/v1',apiKey:'fixture-key',model:'gpt-image-2',fetch});}
describe('Donor GPT Image 2 server adapter',()=>{
  it('preserves the operator-selected count alias only on its selected API origin',async()=>{
    const input={...await request(),model:'gpt-image-2-count'},fetch=vi.fn(async()=>new Response(JSON.stringify({data:[{b64_json:input.images[0]!.buffer.toString('base64')}]}),{headers:{'content-type':'application/json'}}));
    await createDonorGptImage2EditProvider({baseUrl:'https://ai.big-model-api.top',apiKey:'fixture-key',model:'gpt-image-2-count',fetch}).edit(input);
    const [url,init]=fetch.mock.calls[0] as any;expect(url).toBe('https://ai.big-model-api.top/v1/images/edits');expect(init.body.get('model')).toBe('gpt-image-2-count');
    expect(()=>createDonorGptImage2EditProvider({baseUrl:'https://different.fixture.example',apiKey:'fixture-key',model:'gpt-image-2-count',fetch}))
      .toThrow();expect(fetch).toHaveBeenCalledOnce();
  });
  it('matches the donor multipart profile and preserves the reference bytes',async()=>{
    const input=await request(),image=await sharp({create:{width:1008,height:1344,channels:3,background:'blue'}}).png().toBuffer();
    const fetch=vi.fn(async()=>new Response(JSON.stringify({id:'fixture-accepted',data:[{b64_json:image.toString('base64')}]}),{headers:{'content-type':'application/json'}}));
    const result=await provider(fetch).edit(input);expect(fetch).toHaveBeenCalledOnce();
    const [url,init]=fetch.mock.calls[0] as any;expect(url).toBe('https://quality.fixture.example/v1/images/edits');
    const body=init.body as FormData;expect([...body.keys()]).toEqual(['model','prompt','n','size','quality','response_format','image']);
    expect(body.get('model')).toBe('gpt-image-2');expect(body.get('size')).toBe('1008x1344');expect(body.get('quality')).toBe('high');expect(body.get('n')).toBe('1');
    expect(Buffer.from(await (body.get('image') as Blob).arrayBuffer())).toEqual(input.images[0]!.buffer);
    expect(result.images[0]!.buffer).toEqual(image);
  });
  it.each([{model:'another-model'},{width:1024,height:1024},{operation:'INPAINT'},{wanxEditStrength:0.85}])('rejects unsupported donor overrides before dispatch %j',async override=>{
    const fetch=vi.fn();await expect(provider(fetch).edit({...await request(),...override} as any)).rejects.toMatchObject({providerSubmissionRejected:true});expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps donor dimensions scoped to its adapter instead of expanding generic edit acceptance',async()=>{
    const fetch=vi.fn();await expect(createOpenAiImageEditProvider({baseUrl:'https://quality.fixture.example/v1',apiKey:'fixture-key',model:'gpt-image-2',fetch}).edit(await request()))
      .rejects.toMatchObject({code:'INVALID_MEDIA_INPUT',providerSubmissionRejected:true});expect(fetch).not.toHaveBeenCalled();
  });
});
