
(() => {
  "use strict";

  const DEFAULT_AREAS = ["Pessoal","Trabalho","Sítio"];
  const DEFAULT_EXPENSE_CATS = ["⛽ Combustível","🍔 Alimentação","🛒 Mercado","🧾 Contas","🐂 Gado","🔧 Manutenção","➕ Outros"];
  const DEFAULT_INCOME_CATS = ["💵 Venda","💼 Salário","🐂 Venda de gado","↩️ Recebimento","➕ Outros"];
  let AREAS = [...DEFAULT_AREAS];
  let EXPENSE_CATS = [...DEFAULT_EXPENSE_CATS];
  let INCOME_CATS = [...DEFAULT_INCOME_CATS];
  let categoryManageType = "expense";
  let rotativoAction = "use";
  let ROTATIVO_RATE = 3;
  const DB_NAME = "meu-caixa-pessoal";
  const DB_VERSION = 2;
  let db;
  let currentArea = "Tudo";
  let currentScreen = "Home";
  let launchType = "expense";
  let modalArea = "Pessoal";
  let editingId = null;
  let undoTx = null;
  let undoTimer = null;

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const brl = cents => new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format((Number(cents)||0)/100);
  const nowIso = () => new Date().toISOString();
  const id = () => `${Date.now()}-${Math.random().toString(36).slice(2,10)}`;

  function parseMoney(v){
    let s = String(v ?? "").trim().replace(/[^\d,.-]/g,"");
    if (!s) return 0;
    if (s.includes(",")) s = s.replace(/\./g,"").replace(",",".");
    return Math.round(Number(s)*100) || 0;
  }
  function moneyInput(cents){ return ((Number(cents)||0)/100).toFixed(2).replace(".",","); }
  function fmtDate(iso){
    const d = new Date(iso);
    return d.toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})+" • "+d.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
  }

  function openDB(){
    return new Promise((resolve,reject)=>{
      const req = indexedDB.open(DB_NAME,DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if(!d.objectStoreNames.contains("transactions")){
          const s=d.createObjectStore("transactions",{keyPath:"id"});
          s.createIndex("created_at","created_at");
          s.createIndex("area","area");
          s.createIndex("type","type");
        }
        if(!d.objectStoreNames.contains("recurring")){
          d.createObjectStore("recurring",{keyPath:"id"});
        }
        if(!d.objectStoreNames.contains("settings")){
          d.createObjectStore("settings",{keyPath:"key"});
        }
        if(!d.objectStoreNames.contains("rotativo")){
          const r=d.createObjectStore("rotativo",{keyPath:"id"});
          r.createIndex("created_at","created_at");
        }
      };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error);
    });
  }

  function txStore(name, mode="readonly"){ return db.transaction(name,mode).objectStore(name); }
  function reqP(req){ return new Promise((res,rej)=>{req.onsuccess=()=>res(req.result);req.onerror=()=>rej(req.error);}); }
  async function getAll(store){ return reqP(txStore(store).getAll()); }
  async function put(store,obj){ return reqP(txStore(store,"readwrite").put(obj)); }
  async function del(store,key){ return reqP(txStore(store,"readwrite").delete(key)); }

  async function getSetting(key, fallback){
    const row = await reqP(txStore("settings").get(key));
    return row ? row.value : fallback;
  }
  async function setSetting(key, value){
    await put("settings",{key,value,updated_at:nowIso()});
  }
  async function loadCustomStructure(){
    AREAS = await getSetting("areas", [...DEFAULT_AREAS]);
    EXPENSE_CATS = await getSetting("expense_categories", [...DEFAULT_EXPENSE_CATS]);
    INCOME_CATS = await getSetting("income_categories", [...DEFAULT_INCOME_CATS]);
    ROTATIVO_RATE = Number(await getSetting("rotativo_rate", 3)) || 3;
    if(!Array.isArray(AREAS) || AREAS.length===0) AREAS=[...DEFAULT_AREAS];
    if(!Array.isArray(EXPENSE_CATS) || EXPENSE_CATS.length===0) EXPENSE_CATS=[...DEFAULT_EXPENSE_CATS];
    if(!Array.isArray(INCOME_CATS) || INCOME_CATS.length===0) INCOME_CATS=[...DEFAULT_INCOME_CATS];
  }
  function renderAreaTabs(){
    const tabs = ['Tudo', ...AREAS];
    $("#areaTabs").innerHTML = tabs.map(a=>`<button class="area-tab ${a===currentArea?"active":""}" data-area="${escapeHtml(a)}">${escapeHtml(a)}</button>`).join("");
    $$("#areaTabs .area-tab").forEach(b=>b.addEventListener("click",async()=>{
      currentArea=b.dataset.area;
      renderAreaTabs();
      await refreshAll();
    }));
  }

  async function getTransactions(){
    const all=(await getAll("transactions")).filter(x=>!x.deleted_at);
    return all.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
  }
  async function filteredTransactions(area=currentArea){
    const all=await getTransactions();
    if(area==="Tudo") return all;
    return all.filter(x=>x.area===area || (x.type==="transfer" && x.destination_area===area));
  }
  async function summary(area=currentArea){
    const rows=await filteredTransactions(area);
    let income=0,expense=0;
    for(const r of rows){
      if(r.type==="income") income+=r.amount_cents;
      else if(r.type==="expense") expense+=r.amount_cents;
      else if(r.type==="transfer" && area!=="Tudo"){
        if(r.area===area) expense+=r.amount_cents;
        if(r.destination_area===area) income+=r.amount_cents;
      }
    }
    const rot = (await getAll("rotativo")).filter(x=>!x.deleted_at && (area==="Tudo" || x.area===area));
    let rotCash=0;
    for(const r of rot){ rotCash += r.action==="use" ? r.amount_cents : -r.amount_cents; }
    return {income,expense,balance:income-expense+rotCash};
  }

  async function addTx(type, amount_cents, area, category, note=""){
    const row={id:id(),type,amount_cents,area,destination_area:null,category,note,created_at:nowIso(),updated_at:nowIso(),deleted_at:null};
    await put("transactions",row);
    return row;
  }
  async function addTransfer(amount_cents, from, to, note=""){
    const row={id:id(),type:"transfer",amount_cents,area:from,destination_area:to,category:"↔️ Transferência",note,created_at:nowIso(),updated_at:nowIso(),deleted_at:null};
    await put("transactions",row); return row;
  }

  async function generateRecurring(){
    const rules=(await getAll("recurring")).filter(r=>r.active!==false);
    const today=new Date();
    const month=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}`;
    for(const r of rules){
      if(Number(r.day_of_month)<=today.getDate() && r.last_generated_month!==month){
        await addTx(r.type,r.amount_cents,r.area,r.category,r.note||"");
        r.last_generated_month=month;r.updated_at=nowIso();await put("recurring",r);
      }
    }
  }

  function setStatus(){
    const online=navigator.onLine;
    $("#statusBtn").classList.toggle("online",online);
    $("#statusBtn").classList.toggle("offline",!online);
    $("#statusText").textContent=online?"Online":"Offline";
  }

  function showScreen(name){
    currentScreen=name;
    $$(".screen").forEach(x=>x.classList.remove("active"));
    $("#screen"+name).classList.add("active");
    $$(".bottom-btn").forEach(x=>x.classList.toggle("active",x.dataset.screen===name));
    refreshAll();
  }

  function txHtml(t){
    let sign=t.type==="income"?"+":t.type==="expense"?"−":"↔";
    let cls=t.type;
    let amount=(t.type==="transfer"?"":sign+" ")+brl(t.amount_cents);
    let area=t.type==="transfer"?`${t.area} → ${t.destination_area}`:t.area;
    let note=t.note?` • ${escapeHtml(t.note)}`:"";
    return `<button class="tx" data-id="${t.id}" type="button">
      <span class="tx-main"><span class="tx-title">${escapeHtml(t.category)}</span><span class="tx-meta">${area} • ${fmtDate(t.created_at)}${note}</span></span>
      <span class="tx-amount ${cls}">${amount}</span>
    </button>`;
  }
  function escapeHtml(v){ return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m])); }

  async function refreshAll(){
    const s=await summary();
    $("#balanceValue").textContent=brl(s.balance);
    $("#incomeValue").textContent=brl(s.income);
    $("#expenseValue").textContent=brl(s.expense);
    $("#sumBalance").textContent=brl(s.balance);
    $("#sumIncome").textContent=brl(s.income);
    $("#sumExpense").textContent=brl(s.expense);

    const rows=await filteredTransactions();
    $("#recentList").innerHTML=rows.length?rows.slice(0,4).map(txHtml).join(""):`<div class="empty">Nenhum lançamento ainda.</div>`;

    const q=$("#searchInput")?.value?.trim().toLowerCase()||"";
    const found=q?rows.filter(t=>`${t.category} ${t.note||""} ${t.amount_cents}`.toLowerCase().includes(q)):rows;
    $("#movementList").innerHTML=found.length?found.map(txHtml).join(""):`<div class="empty">Nenhum lançamento encontrado.</div>`;

    const cat={};
    rows.filter(r=>r.type==="expense").forEach(r=>cat[r.category]=(cat[r.category]||0)+r.amount_cents);
    const cats=Object.entries(cat).sort((a,b)=>b[1]-a[1]);
    $("#categorySummary").innerHTML=cats.length?cats.map(([n,v])=>`<div class="cat-sum"><span>${escapeHtml(n)}</span><strong>${brl(v)}</strong></div>`).join(""):`<div class="empty">Sem despesas nesta área.</div>`;

    await renderRotativo();
    const rec=(await getAll("recurring")).sort((a,b)=>a.day_of_month-b.day_of_month);
    $("#recurringList").innerHTML=rec.length?rec.map(r=>`<button class="tx recurring-item" data-rec-id="${r.id}" type="button"><span class="tx-main"><span class="tx-title">${escapeHtml(r.category)}</span><span class="tx-meta">${r.area} • dia ${r.day_of_month} • ${r.active===false?"Pausado":"Ativo"}</span></span><span class="tx-amount ${r.type}">${r.type==="income"?"+":"−"} ${brl(r.amount_cents)}</span></button>`).join(""):`<div class="empty">Nenhum recorrente cadastrado.</div>`;
  }

  function openModal(which){
    $("#modalBackdrop").classList.remove("hidden");
    $$("#modalBackdrop .modal-card").forEach(x=>x.classList.add("hidden"));
    $("#"+which).classList.remove("hidden");
  }
  function closeModal(){
    $("#modalBackdrop").classList.add("hidden");
    $$("#modalBackdrop .modal-card").forEach(x=>x.classList.add("hidden"));
    editingId=null;
  }

  function openEntry(type){
    launchType=type;
    modalArea=currentArea==="Tudo"?AREAS[0]:currentArea;
    $("#entryTypeLabel").textContent=type==="income"?"Receita":"Despesa";
    $("#entryTitle").textContent="Lançamento Flash";
    $("#amountInput").value="";
    $("#noteInput").value="";
    $$("#modalAreaTabs .chip").forEach(b=>b.classList.toggle("active",b.dataset.modalArea===modalArea));
    renderCategories();
    openModal("entryModal");
    setTimeout(()=>$("#amountInput").focus(),200);
  }
  function renderCategories(){
    const cats=launchType==="income"?INCOME_CATS:EXPENSE_CATS;
    $("#categoryGrid").innerHTML=cats.map(c=>`<button class="category-btn" type="button" data-category="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join("");
  }

  async function saveFlash(category){
    const cents=parseMoney($("#amountInput").value);
    if(cents<=0){alert("Digite um valor maior que zero.");return;}
    const row=await addTx(launchType,cents,modalArea,category,$("#noteInput").value.trim());
    closeModal();
    showUndo(row);
    await refreshAll();
  }

  function showUndo(row){
    undoTx=row;
    $("#toastText").textContent=`${row.type==="income"?"Receita":"Despesa"} de ${brl(row.amount_cents)} salva`;
    $("#toast").classList.remove("hidden");
    clearTimeout(undoTimer);
    undoTimer=setTimeout(()=>{$("#toast").classList.add("hidden");undoTx=null;},6000);
  }

  async function openEdit(idv){
    const row=(await getTransactions()).find(x=>x.id===idv);
    if(!row)return;
    editingId=row.id;
    $("#editAmount").value=moneyInput(row.amount_cents);
    $("#editCategory").value=row.category||"";
    $("#editNote").value=row.note||"";
    fillAreaSelect($("#editArea"),row.area);
    openModal("editModal");
  }

  function fillAreaSelect(el, selected="Pessoal"){
    el.innerHTML=AREAS.map(a=>`<option value="${a}" ${a===selected?"selected":""}>${a}</option>`).join("");
  }

  async function saveEdit(){
    if(!editingId)return;
    const all=await getTransactions();
    const row=all.find(x=>x.id===editingId); if(!row)return;
    const cents=parseMoney($("#editAmount").value);if(cents<=0){alert("Informe um valor válido.");return;}
    row.amount_cents=cents;row.area=$("#editArea").value;row.category=$("#editCategory").value.trim()||row.category;row.note=$("#editNote").value.trim();row.updated_at=nowIso();
    await put("transactions",row);closeModal();await refreshAll();
  }
  async function deleteEdit(){
    if(!editingId)return;
    if(!confirm("Excluir este lançamento?"))return;
    await del("transactions",editingId);closeModal();await refreshAll();
  }

  async function exportBackup(){
    const data={
      app:"Meu Caixa Pessoal",version:1,exported_at:nowIso(),
      transactions:await getAll("transactions"),
      recurring:await getAll("recurring")
    };
    const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download=`meu-caixa-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    $("#backupInfo").textContent="Backup exportado agora.";
  }

  async function importBackup(file){
    try{
      const data=JSON.parse(await file.text());
      if(!Array.isArray(data.transactions))throw new Error("Arquivo inválido");
      if(!confirm("Importar este backup? Lançamentos com o mesmo ID serão atualizados."))return;
      for(const r of data.transactions) await put("transactions",r);
      for(const r of (data.recurring||[])) await put("recurring",r);
      $("#backupInfo").textContent="Backup importado com sucesso.";
      await refreshAll();
    }catch(e){alert("Não foi possível importar esse backup.");}
  }

  async function saveRecurring(){
    const cents=parseMoney($("#recAmount").value);
    const day=Math.max(1,Math.min(28,Number($("#recDay").value)||1));
    const cat=$("#recCategory").value.trim();
    if(cents<=0||!cat){alert("Informe valor e categoria.");return;}
    await put("recurring",{id:id(),type:$("#recType").value,amount_cents:cents,area:$("#recArea").value,category:cat,note:$("#recNote").value.trim(),day_of_month:day,active:true,last_generated_month:null,created_at:nowIso(),updated_at:nowIso()});
    closeModal();await generateRecurring();await refreshAll();
  }

  async function toggleRecurring(idv){
    const rec=(await getAll("recurring")).find(x=>x.id===idv);if(!rec)return;
    const choice=confirm(`${rec.active===false?"Ativar":"Pausar"} este recorrente?\n\nCancelar = manter como está.`);
    if(choice){rec.active=rec.active===false;rec.updated_at=nowIso();await put("recurring",rec);await refreshAll();}
  }


  async function renderAreasManage(){
    const txs = await getTransactions();
    $("#areasManageList").innerHTML = AREAS.map(a=>{
      const count = txs.filter(t=>t.area===a || t.destination_area===a).length;
      return `<div class="manage-item" data-area-name="${escapeHtml(a)}">
        <div class="manage-item-main"><div class="manage-item-name">${escapeHtml(a)}</div><div class="manage-item-meta">${count} lançamento${count===1?"":"s"}</div></div>
        <div class="manage-actions"><button class="rename-btn" data-rename-area="${escapeHtml(a)}">Renomear</button><button class="remove-btn" data-remove-area="${escapeHtml(a)}">Excluir</button></div>
      </div>`;
    }).join("");
  }

  async function addArea(){
    const name=$("#newAreaInput").value.trim();
    if(!name)return;
    if(name.toLowerCase()==="tudo".toLowerCase() || AREAS.some(a=>a.toLowerCase()===name.toLowerCase())){alert("Essa área já existe.");return;}
    AREAS.push(name); await setSetting("areas",AREAS); $("#newAreaInput").value="";
    renderAreaTabs(); await renderAreasManage(); refreshSelects();
  }

  async function renameArea(oldName){
    const next=prompt("Novo nome da área:",oldName)?.trim();
    if(!next || next===oldName)return;
    if(next.toLowerCase()==="tudo" || AREAS.some(a=>a!==oldName && a.toLowerCase()===next.toLowerCase())){alert("Esse nome já está em uso.");return;}
    const txs=await getAll("transactions");
    for(const t of txs){
      let changed=false;
      if(t.area===oldName){t.area=next;changed=true;}
      if(t.destination_area===oldName){t.destination_area=next;changed=true;}
      if(changed){t.updated_at=nowIso();await put("transactions",t);}
    }
    const recs=await getAll("recurring");
    for(const r of recs){if(r.area===oldName){r.area=next;r.updated_at=nowIso();await put("recurring",r);}}
    AREAS=AREAS.map(a=>a===oldName?next:a); await setSetting("areas",AREAS);
    if(currentArea===oldName) currentArea=next;
    renderAreaTabs(); refreshSelects(); await renderAreasManage(); await refreshAll();
  }

  async function removeArea(name){
    const txs=await getTransactions();
    const used=txs.some(t=>t.area===name || t.destination_area===name);
    const recs=(await getAll("recurring")).some(r=>r.area===name);
    if(used||recs){alert("Essa área possui lançamentos ou recorrentes. Renomeie-a ou mova os registros antes de excluir.");return;}
    if(AREAS.length<=1){alert("É preciso manter pelo menos uma área.");return;}
    if(!confirm(`Excluir a área "${name}"?`))return;
    AREAS=AREAS.filter(a=>a!==name); await setSetting("areas",AREAS);
    if(currentArea===name) currentArea="Tudo";
    renderAreaTabs(); refreshSelects(); await renderAreasManage(); await refreshAll();
  }

  function categoryArray(type){ return type==="income"?INCOME_CATS:EXPENSE_CATS; }
  async function saveCategoryArray(type, arr){
    if(type==="income"){INCOME_CATS=arr;await setSetting("income_categories",arr);}
    else {EXPENSE_CATS=arr;await setSetting("expense_categories",arr);}
  }
  async function renderCategoriesManage(){
    const arr=categoryArray(categoryManageType);
    $("#categoriesManageList").innerHTML=arr.map(c=>`<div class="manage-item">
      <div class="manage-item-main"><div class="manage-item-name">${escapeHtml(c)}</div></div>
      <div class="manage-actions"><button class="rename-btn" data-rename-cat="${escapeHtml(c)}">Renomear</button><button class="remove-btn" data-remove-cat="${escapeHtml(c)}">Excluir</button></div>
    </div>`).join("");
  }
  async function addCategory(){
    const name=$("#newCategoryInput").value.trim(); if(!name)return;
    let arr=[...categoryArray(categoryManageType)];
    if(arr.some(c=>c.toLowerCase()===name.toLowerCase())){alert("Essa categoria já existe.");return;}
    arr.push(name); await saveCategoryArray(categoryManageType,arr); $("#newCategoryInput").value="";
    await renderCategoriesManage(); renderCategories();
  }
  async function renameCategory(oldName){
    const next=prompt("Novo nome da categoria:",oldName)?.trim();if(!next||next===oldName)return;
    let arr=[...categoryArray(categoryManageType)];
    if(arr.some(c=>c!==oldName && c.toLowerCase()===next.toLowerCase())){alert("Esse nome já está em uso.");return;}
    const txs=await getAll("transactions");
    for(const t of txs){if(t.type===categoryManageType && t.category===oldName){t.category=next;t.updated_at=nowIso();await put("transactions",t);}}
    const recs=await getAll("recurring");
    for(const r of recs){if(r.type===categoryManageType && r.category===oldName){r.category=next;r.updated_at=nowIso();await put("recurring",r);}}
    arr=arr.map(c=>c===oldName?next:c);await saveCategoryArray(categoryManageType,arr);
    await renderCategoriesManage();renderCategories();await refreshAll();
  }
  async function removeCategory(name){
    const txs=await getTransactions();
    const used=txs.some(t=>t.type===categoryManageType && t.category===name);
    const recs=(await getAll("recurring")).some(r=>r.type===categoryManageType && r.category===name);
    if(used||recs){alert("Essa categoria já está sendo usada. Renomeie-a em vez de excluir.");return;}
    let arr=categoryArray(categoryManageType);
    if(arr.length<=1){alert("É preciso manter pelo menos uma categoria.");return;}
    if(!confirm(`Excluir a categoria "${name}"?`))return;
    arr=arr.filter(c=>c!==name);await saveCategoryArray(categoryManageType,arr);
    await renderCategoriesManage();renderCategories();
  }
  function refreshSelects(){
    fillAreaSelect($("#transferFrom"), $("#transferFrom").value || AREAS[0]);
    fillAreaSelect($("#transferTo"), $("#transferTo").value || AREAS[Math.min(1,AREAS.length-1)]);
    fillAreaSelect($("#editArea"), $("#editArea").value || AREAS[0]);
    fillAreaSelect($("#recArea"), $("#recArea").value || AREAS[0]);
    fillAreaSelect($("#rotActionArea"), $("#rotActionArea").value || AREAS[0]);
  }


  async function getRotativoRows(){
    return (await getAll("rotativo")).filter(x=>!x.deleted_at).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
  }
  function monthsBetween(fromIso, to=new Date()){
    const from=new Date(fromIso);
    const days=Math.max(0,(to-from)/(1000*60*60*24));
    return days/30.4375;
  }
  async function rotativoDebt(){
    const rows=(await getRotativoRows()).sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)));
    let debt=0, lastDate=null;
    for(const r of rows){
      const dt=new Date(r.created_at);
      if(lastDate && debt>0){
        const months=Math.max(0,(dt-lastDate)/(1000*60*60*24*30.4375));
        debt *= Math.pow(1+ROTATIVO_RATE/100, months);
      }
      if(r.action==="use") debt += r.amount_cents;
      else debt = Math.max(0,debt-r.amount_cents);
      lastDate=dt;
    }
    if(lastDate && debt>0){
      const months=monthsBetween(lastDate);
      debt *= Math.pow(1+ROTATIVO_RATE/100, months);
    }
    return Math.round(debt);
  }
  async function renderRotativo(){
    const debt=await rotativoDebt();
    $("#rotativoDebtValue").textContent=brl(debt);
    $("#rotativoModalDebt").textContent=brl(debt);
    $("#rotativoRate").textContent=ROTATIVO_RATE.toFixed(2).replace(".",",")+"%";
    $("#rotativoInterestInfo").textContent=`Juros configurados: ${ROTATIVO_RATE.toFixed(2).replace(".",",")}% ao mês`;
    const rows=await getRotativoRows();
    $("#rotativoList").innerHTML=rows.length?rows.map(r=>`<div class="rot-row">
      <div><div class="rot-title">${r.action==="use"?"Crédito utilizado":"Pagamento"}${r.note?` • ${escapeHtml(r.note)}`:""}</div><div class="rot-meta">${escapeHtml(r.area)} • ${fmtDate(r.created_at)}</div></div>
      <div class="rot-value ${r.action}">${r.action==="use"?"+":"−"} ${brl(r.amount_cents)}</div>
    </div>`).join(""):`<div class="empty">Nenhuma movimentação no C. Rotativo.</div>`;
  }
  function openRotativoAction(action){
    rotativoAction=action;
    $("#rotActionTitle").textContent=action==="use"?"Usar rotativo":"Pagar rotativo";
    $("#rotActionSmall").textContent=action==="use"?"Entrada de crédito":"Redução do saldo devedor";
    $("#saveRotActionBtn").textContent=action==="use"?"Confirmar uso":"Confirmar pagamento";
    $("#rotActionAmount").value="";$("#rotActionNote").value="";
    fillAreaSelect($("#rotActionArea"), currentArea==="Tudo"?AREAS[0]:currentArea);
    openModal("rotativoActionModal");
    setTimeout(()=>$("#rotActionAmount").focus(),180);
  }
  async function saveRotativoAction(){
    const cents=parseMoney($("#rotActionAmount").value);
    if(cents<=0){alert("Informe um valor válido.");return;}
    if(rotativoAction==="pay"){
      const debt=await rotativoDebt();
      if(cents>debt && debt>0 && !confirm("O pagamento informado é maior que o saldo devedor estimado. Deseja continuar?")) return;
    }
    await put("rotativo",{id:id(),action:rotativoAction,amount_cents:cents,area:$("#rotActionArea").value,note:$("#rotActionNote").value.trim(),created_at:nowIso(),updated_at:nowIso(),deleted_at:null});
    closeModal();await refreshAll();await renderRotativo();
  }
  async function editRotativoRate(){
    const v=prompt("Taxa de juros mensal do C. Rotativo (%):",String(ROTATIVO_RATE).replace(".",","));
    if(v===null)return;
    const n=Number(v.replace(",",".")); if(!Number.isFinite(n)||n<0||n>100){alert("Informe uma taxa válida.");return;}
    ROTATIVO_RATE=n;await setSetting("rotativo_rate",n);await renderRotativo();await refreshAll();
  }

  async function init(){
    db=await openDB();
    await loadCustomStructure();
    renderAreaTabs();
    await generateRecurring();
    setStatus();
    fillAreaSelect($("#transferFrom"),AREAS[0]);
    fillAreaSelect($("#transferTo"),AREAS[Math.min(1,AREAS.length-1)]);
    fillAreaSelect($("#editArea"),AREAS[0]);
    fillAreaSelect($("#recArea"),AREAS[0]);
    fillAreaSelect($("#rotActionArea"),AREAS[0]);

    window.addEventListener("online",setStatus);
    window.addEventListener("offline",setStatus);

    $$(".bottom-btn").forEach(b=>b.addEventListener("click",()=>showScreen(b.dataset.screen)));
    $("#seeAllBtn").addEventListener("click",()=>showScreen("Movements"));
    $("#incomeBtn").addEventListener("click",()=>openEntry("income"));
    $("#expenseBtn").addEventListener("click",()=>openEntry("expense"));
    $("#flashBtn").addEventListener("click",()=>openEntry("expense"));
    $("#transferBtn").addEventListener("click",()=>{
      fillAreaSelect($("#transferFrom"),currentArea==="Tudo"?AREAS[0]:currentArea);
      fillAreaSelect($("#transferTo"),AREAS.find(a=>a!==$("#transferFrom").value)||AREAS[0]);
      $("#transferAmount").value="";$("#transferNote").value="";openModal("transferModal");
    });
    $$("#modalAreaTabs .chip").forEach(b=>b.addEventListener("click",()=>{
      modalArea=b.dataset.modalArea;
      $$("#modalAreaTabs .chip").forEach(x=>x.classList.toggle("active",x===b));
    }));
    $("#categoryGrid").addEventListener("click",e=>{const b=e.target.closest("[data-category]");if(b)saveFlash(b.dataset.category);});
    $$("[data-close-modal]").forEach(b=>b.addEventListener("click",closeModal));
    $("#modalBackdrop").addEventListener("click",e=>{if(e.target===$("#modalBackdrop"))closeModal();});

    $("#saveTransferBtn").addEventListener("click",async()=>{
      const cents=parseMoney($("#transferAmount").value),from=$("#transferFrom").value,to=$("#transferTo").value;
      if(cents<=0){alert("Informe um valor válido.");return;}if(from===to){alert("Origem e destino precisam ser diferentes.");return;}
      await addTransfer(cents,from,to,$("#transferNote").value.trim());closeModal();await refreshAll();
    });

    document.addEventListener("click",e=>{
      const tx=e.target.closest(".tx[data-id]"); if(tx)openEdit(tx.dataset.id);
      const rec=e.target.closest(".recurring-item"); if(rec)toggleRecurring(rec.dataset.recId);
    });
    $("#searchInput").addEventListener("input",refreshAll);
    $("#saveEditBtn").addEventListener("click",saveEdit);
    $("#deleteTxBtn").addEventListener("click",deleteEdit);
    $("#undoBtn").addEventListener("click",async()=>{
      if(!undoTx)return;await del("transactions",undoTx.id);undoTx=null;$("#toast").classList.add("hidden");await refreshAll();
    });

    $("#addRecurringBtn").addEventListener("click",()=>{
      $("#recAmount").value="";$("#recCategory").value="";$("#recNote").value="";$("#recDay").value="1";
      fillAreaSelect($("#recArea"),currentArea==="Tudo"?AREAS[0]:currentArea);openModal("recurringModal");
    });
    $("#saveRecurringBtn").addEventListener("click",saveRecurring);
    $("#exportBtn").addEventListener("click",exportBackup);
    $("#importInput").addEventListener("change",e=>{const f=e.target.files?.[0];if(f)importBackup(f);e.target.value="";});

    $("#manageAreasBtn").addEventListener("click",async()=>{await renderAreasManage();openModal("areasModal");});
    $("#addAreaBtn").addEventListener("click",addArea);
    $("#newAreaInput").addEventListener("keydown",e=>{if(e.key==="Enter")addArea();});
    $("#areasManageList").addEventListener("click",e=>{
      const rn=e.target.closest("[data-rename-area]"); if(rn)renameArea(rn.dataset.renameArea);
      const rm=e.target.closest("[data-remove-area]"); if(rm)removeArea(rm.dataset.removeArea);
    });

    $("#manageCategoriesBtn").addEventListener("click",async()=>{
      categoryManageType=launchType;
      $$(".seg").forEach(x=>x.classList.toggle("active",x.dataset.catType===categoryManageType));
      await renderCategoriesManage();
      openModal("categoriesModal");
    });
    $$(".seg").forEach(b=>b.addEventListener("click",async()=>{
      categoryManageType=b.dataset.catType;
      $$(".seg").forEach(x=>x.classList.toggle("active",x===b));
      await renderCategoriesManage();
    }));
    $("#addCategoryBtn").addEventListener("click",addCategory);
    $("#newCategoryInput").addEventListener("keydown",e=>{if(e.key==="Enter")addCategory();});
    $("#categoriesManageList").addEventListener("click",e=>{
      const rn=e.target.closest("[data-rename-cat]"); if(rn)renameCategory(rn.dataset.renameCat);
      const rm=e.target.closest("[data-remove-cat]"); if(rm)removeCategory(rm.dataset.removeCat);
    });

    $("#rotativoPanelBtn").addEventListener("click",async()=>{await renderRotativo();openModal("rotativoModal");});
    $("#useRotativoBtn").addEventListener("click",()=>openRotativoAction("use"));
    $("#payRotativoBtn").addEventListener("click",()=>openRotativoAction("pay"));
    $("#saveRotActionBtn").addEventListener("click",saveRotativoAction);
    $("#editRateBtn").addEventListener("click",editRotativoRate);

    if("serviceWorker" in navigator){
      try{ await navigator.serviceWorker.register("./sw.js"); }catch(e){ console.warn("SW",e); }
    }
    await refreshAll();
  }

  init().catch(err=>{console.error(err);alert("Não foi possível iniciar o Meu Caixa. Recarregue a página.");});
})();
