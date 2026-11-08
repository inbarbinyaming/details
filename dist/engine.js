/* Details analysis engine. No dependencies, network requests or API keys. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.DetailsEngine=api})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const normalize=value=>String(value??'').trim().toLowerCase().replace(/\s+/g,' ');
  const slug=value=>normalize(value).replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'product';
  const number=value=>{const v=Number(String(value??'').replace(/[$£€,\s]/g,''));return Number.isFinite(v)?v:null};
  function csv(text){
    if(typeof text!=='string')throw Error('CSV content must be text.');
    const rows=[];let row=[],field='',quoted=false;
    text=text.replace(/^\uFEFF/,'');
    for(let i=0;i<text.length;i++){const c=text[i];
      if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++}else if(quoted||field==='')quoted=!quoted;else throw Error('Unexpected quote at character '+(i+1));}
      else if(c===','&&!quoted){row.push(field);field='';}
      else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(v=>v.trim()))rows.push(row);row=[];field='';}
      else field+=c;
    }
    if(quoted)throw Error('CSV has an unclosed quoted field.');
    row.push(field);if(row.some(v=>v.trim()))rows.push(row);
    if(!rows.length)throw Error('CSV has no data.');
    const columns=rows[0].map(normalize);if(new Set(columns).size!==columns.length)throw Error('CSV contains duplicate column headers.');
    const data=rows.slice(1).map((r,i)=>{if(r.length!==columns.length)throw Error('Row '+(i+2)+' has '+r.length+' columns; expected '+columns.length);return Object.fromEntries(columns.map((k,j)=>[k,r[j].trim()]))});
    return {columns,data};
  }
  const aliases={
    products:{handle:['handle','product handle'],title:['title','product title','product name'],sku:['variant sku','sku'],price:['variant price','price'],stock:['variant inventory qty','inventory quantity','inventory qty','stock'],category:['type','product type','category']},
    orders:{id:['name','order id','order number','order name'],item:['lineitem name','line item name','product title','product name'],sku:['lineitem sku','line item sku','sku'],date:['created at','created_at','date'],cancel:['cancelled at','cancelled_at'],financial:['financial status']},
    views:{handle:['handle','product handle'],title:['product','product title','product name','title'],views:['views','product views','sessions','sessions with product views','visitors'],date:['date','day','created at']}
  };
  function field(row,kind,key){for(const name of aliases[kind][key]||[])if(Object.hasOwn(row,name)&&row[name]!=='')return row[name];return ''}
  function hasField(columns,kind,key){return (aliases[kind][key]||[]).some(v=>columns.includes(v))}
  function validate(text,kind){
    if(!aliases[kind])throw Error('Unknown report type.');
    const parsed=csv(text),errors=[],warnings=[];
    if(!parsed.data.length)errors.push('The report has no data rows.');
    const required=kind==='products'?[['handle','title']]:kind==='orders'?[['id'],['item','sku']]:[['handle','title'],['views']];
    for(const set of required)if(!set.some(k=>hasField(parsed.columns,kind,k)))errors.push('Missing column: '+set.map(k=>aliases[kind][k][0]).join(' or '));
    if(kind==='views')parsed.data.forEach((r,i)=>{const v=field(r,kind,'views');if(v!==''&&(number(v)===null||number(v)<0))errors.push('Row '+(i+2)+': views must be a non-negative number.')});
    if(kind==='orders'&&!hasField(parsed.columns,kind,'date'))warnings.push('No order date column. A verified 14-day comparison needs dated orders.');
    if(kind==='views'&&!hasField(parsed.columns,kind,'date'))warnings.push('No view date column. A verified 14-day comparison needs dated views.');
    if(parsed.data.length>50000)warnings.push('Large report: '+parsed.data.length+' rows.');
    return {...parsed,errors:errors.slice(0,12),warnings};
  }
  function buildReport(input){
    for(const kind of ['products','orders','views'])if(!input[kind]||input[kind].errors.length)throw Error('Upload a valid '+kind+' report first.');
    const byId=new Map(),bySku=new Map(),byTitle=new Map(),unmatched={orders:0,views:0},warnings=[];
    for(const row of input.products.data){
      const title=field(row,'products','title'),handle=field(row,'products','handle');if(!title&&!handle)continue;
      const id=slug(handle||title);let p=byId.get(id);
      if(!p){p={id,name:title||handle,handle:normalize(handle),category:field(row,'products','category')||'Uncategorized',stock:0,price:0,views:0,orders:0,rate:null,skus:[],recommendations:[],priority:'Unknown',orderIds:new Set(),viewDates:[],orderDates:[],hasStock:false};byId.set(id,p)}
      const sku=normalize(field(row,'products','sku'));if(sku){bySku.set(sku,p);if(!p.skus.includes(sku))p.skus.push(sku)}
      const stock=number(field(row,'products','stock'));if(stock!==null){p.stock+=stock;p.hasStock=true}
      const price=number(field(row,'products','price'));if(price!==null&&price>0)p.price=price;
      if(title)byTitle.set(normalize(title),p);if(handle)byTitle.set(normalize(handle),p);
    }
    const match=(row,kind)=>bySku.get(normalize(field(row,kind,'sku')))||byId.get(slug(field(row,kind,'handle')))||byTitle.get(normalize(field(row,kind,'title')||field(row,kind,'item')));
    for(const row of input.orders.data){
      if(field(row,'orders','cancel'))continue;
      if(normalize(field(row,'orders','financial')).includes('refund'))continue;
      const p=match(row,'orders');if(!p){unmatched.orders++;continue}
      const orderId=field(row,'orders','id');if(!orderId)continue;
      p.orderIds.add(orderId);const date=field(row,'orders','date');if(date)p.orderDates.push(date);
    }
    for(const row of input.views.data){
      const p=match(row,'views');if(!p){unmatched.views++;continue}
      const value=number(field(row,'views','views'));if(value===null||value<0)continue;
      p.views+=value;const date=field(row,'views','date');if(date)p.viewDates.push(date);
    }
    const products=[...byId.values()];if(!products.length)throw Error('No products could be extracted from the catalog.');
    for(const p of products){p.orders=p.orderIds.size;delete p.orderIds;p.rate=p.views>0?+(p.orders/p.views*100).toFixed(2):null}
    const totalViews=products.reduce((s,p)=>s+p.views,0),totalOrders=products.reduce((s,p)=>s+p.orders,0);
    const storeRate=totalViews?+(totalOrders/totalViews*100).toFixed(2):null;
    for(const p of products){
      p.priority=p.hasStock&&p.stock<=10?'Low stock':p.rate===null?'Insufficient data':storeRate!==null&&p.rate<storeRate-0.3?'Needs attention':'Performing well';
      p.recommendations=p.priority==='Low stock'?['stock','addon','photos']:p.rate===null?['category','photos','addon']:p.priority==='Needs attention'?['photos','category','addon']:['addon','photos','category'];
      p.photo=0;p.icon='📦';p.rate=p.rate??0;
    }
    if(unmatched.orders||unmatched.views)warnings.push(`${unmatched.orders} order rows and ${unmatched.views} view rows could not be matched to products.`);
    if(!totalViews)warnings.push('No matched product views. Conversion rates cannot be calculated.');
    const dateComplete=hasField(input.orders.columns,'orders','date')&&hasField(input.views.columns,'views','date');
    if(!dateComplete)warnings.push('Report dates are incomplete: do not interpret this as a verified before/after comparison.');
    return {products,storeRate,totalViews,totalOrders,unmatched,warnings,dateComplete,analyzedAt:new Date().toISOString(),source:'uploaded CSV'};
  }
  function compare(baseline,followup){
    if(!baseline?.dateComplete||!followup?.dateComplete)return {verified:false,reason:'Dated Orders and Product views reports are required for a verified comparison.'};
    if(!Number.isFinite(baseline.rate)||!Number.isFinite(followup.rate))return {verified:false,reason:'Baseline or follow-up conversion rate is missing.'};
    return {verified:true,before:baseline.rate,after:followup.rate,deltaPoints:+(followup.rate-baseline.rate).toFixed(2)};
  }
  function evaluateWindow(product,orders,views,startedAt,days=14){
    if(orders.errors?.length||views.errors?.length)return {ready:false,reason:'Fix CSV validation errors first.'};
    if(!hasField(orders.columns,'orders','date')||!hasField(views.columns,'views','date'))return {ready:false,reason:'Dated orders and views are required for a 14-day result.'};
    const start=new Date(startedAt);if(!Number.isFinite(+start))return {ready:false,reason:'A valid publish date is required.'};
    const end=new Date(+start+days*86400000);
    if(new Date()<end)return {ready:false,reason:'The observation window is not complete.'};
    const same=(row,kind)=>product.skus?.some(x=>normalize(x)===normalize(field(row,kind,'sku')))||normalize(field(row,kind,'handle'))===normalize(product.handle)||normalize(field(row,kind,'item')||field(row,kind,'title'))===normalize(product.name);
    let totalViews=0,invalidDates=0,matchedDates=0;const uniqueOrders=new Set();
    for(const row of views.data){if(!same(row,'views'))continue;const d=new Date(field(row,'views','date'));if(!Number.isFinite(+d)){invalidDates++;continue}matchedDates++;if(d>=start&&d<end)totalViews+=number(field(row,'views','views'))||0}
    for(const row of orders.data){if(!same(row,'orders')||field(row,'orders','cancel'))continue;const d=new Date(field(row,'orders','date'));if(!Number.isFinite(+d)){invalidDates++;continue}matchedDates++;if(d>=start&&d<end&&field(row,'orders','id'))uniqueOrders.add(field(row,'orders','id'))}
    if(invalidDates||!matchedDates||!totalViews)return {ready:false,reason:invalidDates?'Some report rows have invalid dates.':'No matched product views in the observation window.'};
    const rate=+(uniqueOrders.size/totalViews*100).toFixed(2);
    return {ready:true,rate,orders:uniqueOrders.size,views:totalViews,baseline:product.rate,deltaPoints:+(rate-product.rate).toFixed(2),periodStart:start.toISOString(),periodEnd:end.toISOString(),verified:false,reason:'Directional result only. CSV row dates do not prove complete report coverage or causation.'};
  }
  return {csv,validate,buildReport,compare,evaluateWindow,aliases};
});
