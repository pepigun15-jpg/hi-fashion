import { corsHeaders } from "../_shared/cors.ts";

const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{
  status,headers:{...corsHeaders,"Content-Type":"application/json","Cache-Control":"public, max-age=45"}
});
const escapeGraphQL=(value:string)=>value.replace(/\\/g,"\\\\").replace(/"/g,'\\"').replace(/\n/g," ");

Deno.serve(async(request:Request)=>{
  if(request.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
  if(request.method!=="GET")return json({error:"Method not allowed."},405);

  const token=Deno.env.get("CJ_PERSONAL_ACCESS_TOKEN")||"";
  const companyId=Deno.env.get("CJ_COMPANY_ID")||"";
  const publisherId=Deno.env.get("CJ_PUBLISHER_ID")||"";
  if(!token||!companyId||!publisherId){
    return json({error:"CJ Product Feed API is not configured yet.",setup:["CJ_PERSONAL_ACCESS_TOKEN","CJ_COMPANY_ID","CJ_PUBLISHER_ID"],configured:false},424);
  }

  const url=new URL(request.url);
  const query=(url.searchParams.get("q")||"").trim().slice(0,100);
  if(!query)return json({error:"Enter a product search query."},400);
  const limit=Math.max(1,Math.min(Number(url.searchParams.get("limit")||24),100));
  const offset=Math.max(0,Math.min(Number(url.searchParams.get("offset")||0),100000));
  const graphQuery=`{
    products(companyId: "${escapeGraphQL(companyId)}", keywords: "${escapeGraphQL(query)}", offset: ${offset}, limit: ${limit}) {
      totalCount
      count
      resultList {
        advertiserId
        catalogId
        id
        title
        description
        price { amount currency }
        linkCode(pid: "${escapeGraphQL(publisherId)}") { clickUrl }
      }
    }
  }`;

  try{
    const response=await fetch("https://ads.api.cj.com/query",{
      method:"POST",
      headers:{
        "Authorization":"Bearer "+token,
        "Content-Type":"application/json",
        "Accept":"application/json",
      },
      body:JSON.stringify({query:graphQuery}),
    });
    const payload=await response.json().catch(()=>({}));
    if(!response.ok||payload.errors?.length){
      const messages=Array.isArray(payload.errors)?payload.errors.map((e:any)=>e.message).filter(Boolean):[];
      return json({error:messages.join("; ").slice(0,500)||"CJ Product Feed API returned an error.",providerStatus:response.status,configured:true},response.status>=500?502:502);
    }
    const result=payload.data?.products||payload.data?.shoppingProducts||{};
    const items=(result.resultList||[]).map((item:any)=>({
      id:String(item.id||""),
      title:String(item.title||"CJ product"),
      brand:"",
      description:String(item.description||""),
      imageUrl:"",
      price:item.price?.amount!==undefined?Number(item.price.amount):null,
      currency:String(item.price?.currency||""),
      retailer:"CJ advertiser "+String(item.advertiserId||""),
      retailerCountry:"",
      availability:"unknown",
      productUrl:item.linkCode?.clickUrl||"",
      affiliateUrl:item.linkCode?.clickUrl||"",
      source:"CJ Affiliate",
      advertiserId:String(item.advertiserId||""),
      catalogId:String(item.catalogId||""),
    }));
    return json({
      provider:"CJ Affiliate",
      query,
      total:Number(result.totalCount||result.count||items.length),
      offset,
      limit,
      affiliateTrackingActive:items.some((item:any)=>Boolean(item.affiliateUrl)),
      items,
      configured:true,
    });
  }catch(error){
    return json({error:error instanceof Error?error.message:"CJ search failed.",configured:true},502);
  }
});
