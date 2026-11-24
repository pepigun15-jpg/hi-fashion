import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

type CsvResult = { rows: string[][]; consumed: number };
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const FIELD_ALIASES: Record<string, string[]> = {
  external_id: ["product_id", "aw_product_id", "catalog-item-id", "catalog_item_id", "sku", "id", "merchant_product_id"],
  title: ["product_name", "name", "title"],
  brand: ["brand_name", "brand", "manufacturer", "label"],
  description: ["description", "short_description", "product_description"],
  department: ["department", "product_type", "category_name", "merchant_category", "category"],
  category: ["category_name", "category", "product_type", "merchant_category"],
  category_path: ["category_path", "category_tree", "google_product_category"],
  gender: ["gender", "target_gender", "target_audience"],
  image_url: ["merchant_image_url", "image_url", "image-url", "image", "image_link", "large_image"],
  product_url: ["aw_deep_link", "buy-url", "buy_url", "product_url", "link", "url", "deeplink"],
  affiliate_url: ["aw_deep_link", "buy-url", "buy_url", "affiliate_url", "tracking_url", "product_url"],
  price: ["search_price", "price", "retail-price", "retail_price", "standard_price", "sale-price", "sale_price"],
  sale_price: ["sale-price", "sale_price", "discount_price", "search_price"],
  currency: ["currency", "currency_code", "currency-code"],
  availability: ["stock_status", "availability", "in_stock", "stock"],
  sizes: ["size", "sizes", "size_name", "size_name_list"],
  colors: ["colour", "color", "colors", "colour_name", "color_name"],
  retailer: ["merchant_name", "advertiser-name", "advertiser_name", "merchant", "retailer", "shop_name"],
  retailer_country: ["merchant_country", "country_code", "country", "retailer_country", "advertiser_country"],
  ships_to: ["ships_to", "shipping_countries", "delivery_countries", "countries"],
  updated_at: ["last_updated", "updated_at", "modified_date", "date_modified"],
};
const norm = (s: string) => s.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[\s-]+/g, "_");
const decoder = new TextDecoder("utf-8");

function detectDelimiter(bytes: Uint8Array): string {
  let sampleEnd = bytes.indexOf(10);
  if (sampleEnd < 0 || sampleEnd > 8192) sampleEnd = Math.min(bytes.length, 8192);
  const sample = bytes.slice(0, sampleEnd);
  let quoted = false;
  const counts = new Map<number, number>([[44,0],[59,0],[9,0]]);
  for (let i=0;i<sample.length;i++) {
    const b=sample[i];
    if (b===34) {
      if (quoted && sample[i+1]===34) { i++; continue; }
      quoted=!quoted;
    } else if (!quoted && counts.has(b)) counts.set(b,(counts.get(b)||0)+1);
  }
  const winner=[...counts.entries()].sort((a,b)=>b[1]-a[1])[0];
  return winner[0]===9 ? "\t" : String.fromCharCode(winner[0]);
}

function parseCsv(bytes: Uint8Array, delimiter: string, finalChunk: boolean): CsvResult {
  const delim=delimiter.charCodeAt(0);
  const rows: string[][]=[];
  let row: string[]=[];
  let field: number[]=[];
  let quoted=false;
  let rowStart=0;
  const pushField=()=>{row.push(decoder.decode(new Uint8Array(field)).replace(/^\uFEFF/,"").trim());field=[];};
  const pushRow=()=>{pushField();if(row.some(x=>x!==""))rows.push(row);row=[];};
  for(let i=0;i<bytes.length;i++){
    const b=bytes[i];
    if(quoted){
      if(b===34){
        if(i+1<bytes.length && bytes[i+1]===34){field.push(34);i++;}
        else quoted=false;
      } else field.push(b);
      continue;
    }
    if(b===34 && field.length===0){quoted=true;continue;}
    if(b===delim){pushField();continue;}
    if(b===10 || b===13){
      if(b===13 && bytes[i+1]===10)i++;
      pushRow();rowStart=i+1;continue;
    }
    field.push(b);
  }
  const incomplete=quoted;
  if(finalChunk && !incomplete && rowStart<bytes.length) {
    pushRow();
    rowStart=bytes.length;
  }
  return {rows,consumed:incomplete || rowStart<bytes.length ? rowStart : bytes.length};
}

function getValue(record: Record<string,string>, field: string): string {
  for (const key of FIELD_ALIASES[field]||[]) {
    const value=record[norm(key)];
    if(value!==undefined && value.trim()!=="")return value.trim();
  }
  return "";
}
function splitList(value: string): string[] {
  return value.split(/[|;,]/).map(x=>x.trim()).filter(Boolean).slice(0,80);
}
function parseMoney(value: string): number | null {
  if(!value)return null;
  let raw=value.replace(/[^0-9,.-]/g,"");
  if(!raw)return null;
  const comma=raw.lastIndexOf(","), dot=raw.lastIndexOf(".");
  if(comma>=0 && dot>=0) {
    raw=comma>dot?raw.replace(/\./g,"").replace(",","."):raw.replace(/,/g,"");
  } else if(comma>=0) {
    const trailing=raw.length-comma-1;
    raw=trailing===2?raw.replace(",","."):raw.replace(/,/g,"");
  }
  const n=Number(raw);
  if(!Number.isFinite(n)||n<0||n>100000000)return null;
  return Math.round(n*100);
}
function normalizeAvailability(value: string): string {
  const v=value.toLowerCase();
  if(/in.?stock|available|yes|true|\b1\b|instock/.test(v))return "in_stock";
  if(/out.?of.?stock|unavailable|no|false|\b0\b|discontinued/.test(v))return "out_of_stock";
  if(/pre.?order|preorder|back.?order/.test(v))return "preorder";
  return "unknown";
}
function iso2(value: string, fallback="ZZ"): string {
  const v=value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(v)?v:fallback;
}
function mapRow(headers: string[], values: string[], source: string, countryDefault: string, runId: string) {
  const record: Record<string,string>={};
  headers.forEach((h,i)=>record[norm(h)]=values[i]||"");
  const externalId=getValue(record,"external_id");
  const title=getValue(record,"title");
  const productUrl=getValue(record,"product_url");
  if(!externalId||!title||!productUrl)return null;
  const currency=iso2(getValue(record,"currency"),"EUR") === "ZZ" ? "EUR" : getValue(record,"currency").trim().toUpperCase().slice(0,3);
  const mainPrice=getValue(record,"price");
  const salePrice=getValue(record,"sale_price");
  const country=iso2(getValue(record,"retailer_country"),countryDefault);
  const rawAvailability=getValue(record,"availability");
  const path=getValue(record,"category_path");
  const categoryPath=splitList(path || getValue(record,"category"));
  return {
    source_code:source,external_id:externalId.slice(0,240),title:title.slice(0,500),
    brand:getValue(record,"brand").slice(0,180),
    description:getValue(record,"description").slice(0,5000),
    department:getValue(record,"department").slice(0,180),
    category:getValue(record,"category").slice(0,180),
    category_path:categoryPath,
    gender:getValue(record,"gender").slice(0,40),
    image_url:getValue(record,"image_url").slice(0,2000)||null,
    product_url:productUrl.slice(0,3000),
    affiliate_url:(getValue(record,"affiliate_url")||productUrl).slice(0,3000),
    price_minor:parseMoney(mainPrice),
    sale_price_minor:parseMoney(salePrice),
    currency:/^[A-Z]{3}$/.test(currency)?currency:"EUR",
    availability:normalizeAvailability(rawAvailability),
    sizes:splitList(getValue(record,"sizes")),
    colors:splitList(getValue(record,"colors")),
    retailer:(getValue(record,"retailer")||source.toUpperCase()).slice(0,180),
    retailer_country:country,
    ships_to:splitList(getValue(record,"ships_to")).map(x=>iso2(x)).filter(x=>x!=="ZZ"),
    source_updated_at:getValue(record,"updated_at") ? new Date(getValue(record,"updated_at")).toISOString() : null,
    imported_at:new Date().toISOString(),
    last_seen_sync_run_id:runId,
    is_active:true,
  };
}

async function readBounded(response: Response, maximum: number): Promise<{bytes:Uint8Array; done:boolean}> {
  const reader=response.body?.getReader();
  if(!reader)throw new Error("Feed response has no readable body.");
  const chunks:Uint8Array[]=[];
  let total=0,done=false;
  try {
    while(total<=maximum){
      const part=await reader.read();
      if(part.done){done=true;break;}
      chunks.push(part.value);total+=part.value.length;
      if(total>maximum){await reader.cancel();break;}
    }
  } finally {
    try{reader.releaseLock();}catch{}
  }
  const bytes=new Uint8Array(Math.min(total,maximum+1));
  let cursor=0;
  for(const chunk of chunks){const take=Math.min(chunk.length,bytes.length-cursor);if(take<=0)break;bytes.set(chunk.subarray(0,take),cursor);cursor+=take;}
  return {bytes,done};
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
  if(req.method!=="POST")return json({error:"POST required."},405);
  try{
    const supabaseUrl=Deno.env.get("SUPABASE_URL")||"";
    const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
    if(!supabaseUrl||!serviceKey)return json({error:"Supabase service configuration is missing."},503);
    const token=req.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    if(!token)return json({error:"Sign in with an authorised administrator account."},401);
    const admin=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:{user},error:authError}=await admin.auth.getUser(token);
    if(authError||!user)return json({error:"Invalid administrator session."},401);
    const admins=(Deno.env.get("ADMIN_USER_IDS")||"").split(",").map(x=>x.trim()).filter(Boolean);
    if(!admins.includes(user.id))return json({error:"Administrator access is required."},403);

    const body=await req.json().catch(()=>({}));
    const source=String(body.source_code||"").toLowerCase();
    if(!["awin","cj"].includes(source))return json({error:"Supported feed sources are awin and cj."},400);
    const prefix=source.toUpperCase();
    const feedUrl=Deno.env.get(`${prefix}_FEED_URL`)||Deno.env.get(`CATALOGUE_FEED_URL_${prefix}`)||"";
    if(!feedUrl)return json({error:`Add ${prefix}_FEED_URL as a private Supabase Edge Function secret.`,source,configured:false},424);
    const parsedUrl=new URL(feedUrl);
    if(!["https:"].includes(parsedUrl.protocol))return json({error:"Partner feed URLs must use HTTPS."},400);
    const feedKeyBytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(feedUrl));
    const feedKey=[...new Uint8Array(feedKeyBytes)].map(x=>x.toString(16).padStart(2,"0")).join("").slice(0,24);
    const configuredCountry=iso2(Deno.env.get(`${prefix}_DEFAULT_COUNTRY`)||"ZZ");
    const maxBytes=Math.max(262144,Math.min(Number(Deno.env.get("CATALOGUE_IMPORT_BYTES_PER_RUN")||4194304),8388608));
    const maxRows=Math.max(100,Math.min(Number(Deno.env.get("CATALOGUE_IMPORT_MAX_ROWS_PER_RUN")||15000),25000));

    const {data:sourceRow,error:sourceError}=await admin.from("catalogue_sources").select("source_code").eq("source_code",source).maybeSingle();
    if(sourceError||!sourceRow)return json({error:"Catalogue source is missing. Apply the catalogue migrations first."},424);

    const {data:cursor}=await admin.from("catalogue_feed_cursors").select("*").eq("source_code",source).maybeSingle();
    let runId=cursor?.feed_key===feedKey?cursor?.current_sync_run_id:null;
    let offset=cursor?.feed_key===feedKey?Number(cursor?.last_byte_offset||0):0;
    let headers:Array<string>=cursor?.feed_key===feedKey?(cursor.header_columns||[]):[];
    let delimiter=cursor?.feed_key===feedKey?(cursor.delimiter||","):",";
    if(!runId){
      const {data:run,error}=await admin.from("catalogue_sync_runs").insert({source_code:source,status:"running",message:"Partner feed import started."}).select("id").single();
      if(error||!run)return json({error:"Could not create feed sync record."},500);
      runId=run.id;offset=0;headers=[];delimiter=",";
    }

    const end=offset+maxBytes-1;
    const requestHeaders:Record<string,string>={Range:`bytes=${offset}-${end}`,Accept:"text/csv,text/tab-separated-values,text/plain,*/*"};
    const bearer=Deno.env.get(`${prefix}_FEED_BEARER_TOKEN`);
    if(bearer)requestHeaders.Authorization=`Bearer ${bearer}`;
    const feedResponse=await fetch(feedUrl,{headers:requestHeaders,redirect:"follow"});
    if(!feedResponse.ok)return json({error:`Partner feed returned HTTP ${feedResponse.status}.`,source},502);

    let contentRange=feedResponse.headers.get("content-range")||"";
    let totalBytes:number|null=null;
    let finalChunk=false;
    const rangeMatch=contentRange.match(/bytes\s+(\d+)-(\d+)\/(\d+|\*)/i);
    if(feedResponse.status===206){
      if(!rangeMatch)return json({error:"Feed server returned 206 without a valid Content-Range header."},502);
      const actualStart=Number(rangeMatch[1]);
      if(actualStart!==offset)return json({error:"Feed byte range does not match the saved checkpoint; restart this feed."},409);
      if(rangeMatch[3]!=="*")totalBytes=Number(rangeMatch[3]);
      finalChunk=totalBytes!==null && Number(rangeMatch[2])>=totalBytes-1;
    }else if(feedResponse.status===200){
      if(offset>0)return json({error:"This feed host does not support HTTP byte ranges, so a large feed cannot resume. Use a partner download URL with Range support or a smaller CSV file."},409);
    }else return json({error:"Unexpected partner feed response."},502);

    const read=await readBounded(feedResponse,maxBytes);
    if(read.bytes.length>maxBytes){
      return json({error:"The feed host ignored byte-range requests and the feed is too large for one run. Ask the partner for a Range-enabled CSV/TSV URL.",source},413);
    }
    if(feedResponse.status===200){
      if(!read.done)return json({error:"The feed does not support resumable byte ranges and exceeds the import batch size.",source},413);
      totalBytes=read.bytes.length;finalChunk=true;
    }
    const bytes=read.bytes;
    if(!headers.length){
      delimiter=detectDelimiter(bytes);
      const parsed=parseCsv(bytes,delimiter,finalChunk);
      if(parsed.rows.length<1)return json({error:"Feed does not contain a CSV header row."},422);
      headers=parsed.rows[0].map(x=>x.trim());
      const dataRows=parsed.rows.slice(1);
      const dataBytes=bytes.slice(parsed.rows.length>1?parsed.consumed:parsed.consumed);
      // Reparse after the header row is consumed using its precise byte boundary.
      const firstRowEnd=findFirstCsvRecordEnd(bytes);
      const rest=bytes.slice(firstRowEnd);
      const parsedData=parseCsv(rest,delimiter,finalChunk);
      const processed=await importRows(admin,source,runId,headers,parsedData.rows,configuredCountry,maxRows);
      const nextOffset=firstRowEnd+parsedData.consumed;
      const isComplete=finalChunk && nextOffset>=bytes.length;
      return await finishBatch(admin,source,feedKey,runId,nextOffset,totalBytes,headers,delimiter,processed,isComplete);
    }else{
      const parsed=parseCsv(bytes,delimiter,finalChunk);
      const processed=await importRows(admin,source,runId,headers,parsed.rows,configuredCountry,maxRows);
      const nextOffset=offset+parsed.consumed;
      const isComplete=finalChunk && parsed.consumed>=bytes.length;
      return await finishBatch(admin,source,feedKey,runId,nextOffset,totalBytes,headers,delimiter,processed,isComplete);
    }
  }catch(error){
    return json({error:error instanceof Error?error.message:"Catalogue import failed."},500);
  }
});

function findFirstCsvRecordEnd(bytes:Uint8Array):number{
  let quoted=false;
  for(let i=0;i<bytes.length;i++){
    if(bytes[i]===34){
      if(quoted&&bytes[i+1]===34){i++;continue;}
      quoted=!quoted;
    }else if(!quoted&&(bytes[i]===10||bytes[i]===13)){
      if(bytes[i]===13&&bytes[i+1]===10)return i+2;
      return i+1;
    }
  }
  return bytes.length;
}

async function importRows(admin:any,source:string,runId:string,headers:string[],values:string[][],countryDefault:string,maxRows:number){
  const rows:any[]=[];
  let failed=0,received=0;
  for(const valuesRow of values.slice(0,maxRows)){
    received++;
    const row=mapRow(headers,valuesRow,source,countryDefault,runId);
    if(row)rows.push(row);else failed++;
  }
  let imported=0;
  for(let i=0;i<rows.length;i+=500){
    const batch=rows.slice(i,i+500);
    const {error}=await admin.from("catalogue_products").upsert(batch,{onConflict:"source_code,external_id,retailer_country"});
    if(error)throw new Error(`Product batch write failed: ${error.message}`);
    imported+=batch.length;
  }
  return {received,imported,failed};
}

async function finishBatch(admin:any,source:string,feedKey:string,runId:string,nextOffset:number,totalBytes:number|null,headers:string[],delimiter:string,counts:{received:number;imported:number;failed:number},complete:boolean){
  const {data:cursor,error:cursorError}=await admin.from("catalogue_feed_cursors").upsert({
    source_code:source,feed_key:feedKey,last_row_number:0,last_byte_offset:nextOffset,
    header_columns:headers,delimiter,total_bytes:totalBytes,current_sync_run_id:runId,
    updated_at:new Date().toISOString(),
  },{onConflict:"source_code"}).select("source_code").single();
  if(cursorError)throw new Error(`Could not save feed checkpoint: ${cursorError.message}`);
  const {data:run}=await admin.from("catalogue_sync_runs").select("received_count,imported_count,failed_count").eq("id",runId).single();
  const totals={
    received_count:Number(run?.received_count||0)+counts.received,
    imported_count:Number(run?.imported_count||0)+counts.imported,
    failed_count:Number(run?.failed_count||0)+counts.failed,
  };
  if(complete){
    const {error:deactivateError}=await admin.from("catalogue_products").update({is_active:false,updated_at:new Date().toISOString()})
      .eq("source_code",source).neq("last_seen_sync_run_id",runId);
    if(deactivateError)throw new Error(`Could not retire stale feed products: ${deactivateError.message}`);
    await admin.from("catalogue_sources").update({
      is_enabled:true,last_synced_at:new Date().toISOString(),last_sync_status:counts.failed?"partial":"ok",
      last_sync_message:`Imported ${totals.imported_count} products; skipped ${totals.failed_count} incomplete rows.`,
      updated_at:new Date().toISOString(),
    }).eq("source_code",source);
    await admin.from("catalogue_sync_runs").update({
      ...totals,status:counts.failed||totals.failed_count?"partial":"succeeded",
      message:`Feed import complete. ${totals.imported_count} products imported; ${totals.failed_count} rows skipped.`,
      finished_at:new Date().toISOString(),
    }).eq("id",runId);
    await admin.from("catalogue_feed_cursors").delete().eq("source_code",source);
    return json({success:true,complete:true,source,runId,...totals,totalBytes,sourceEnabled:true});
  }
  await admin.from("catalogue_sync_runs").update({...totals,status:"running",message:`Imported ${totals.imported_count} products so far; feed checkpoint at byte ${nextOffset}.`}).eq("id",runId);
  return json({success:true,complete:false,source,runId,...totals,nextByteOffset:nextOffset,totalBytes,sourceEnabled:false});
}
