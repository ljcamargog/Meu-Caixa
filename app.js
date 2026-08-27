
(() => {
  "use strict";

  const AREAS = ["Pessoal","Trabalho","Sítio"];
  const EXPENSE_CATS = ["⛽ Combustível","🍔 Alimentação","🛒 Mercado","🧾 Contas","🐂 Gado","🔧 Manutenção","➕ Outros"];
  const INCOME_CATS = ["💵 Venda","💼 Salário","🐂 Venda de gado","↩️ Recebimento","➕ Outros"];
  const DB_NAME = "meu-caixa-pessoal";
  const DB_VERSION = 1;
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
    return {income,expense,balance:income-expense};
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
    modalArea=currentArea==="Tudo"?"Pessoal":currentArea;
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

  async function init(){
    db=await openDB();
    await generateRecurring();
    setStatus();
    fillAreaSelect($("#transferFrom"),"Pessoal");
    fillAreaSelect($("#transferTo"),"Trabalho");
    fillAreaSelect($("#editArea"),"Pessoal");
    fillAreaSelect($("#recArea"),"Pessoal");

    window.addEventListener("online",setStatus);
    window.addEventListener("offline",setStatus);

    $$(".area-tab").forEach(b=>b.addEventListener("click",async()=>{
      currentArea=b.dataset.area;
      $$(".area-tab").forEach(x=>x.classList.toggle("active",x===b));
      await refreshAll();
    }));
    $$(".bottom-btn").forEach(b=>b.addEventListener("click",()=>showScreen(b.dataset.screen)));
    $("#seeAllBtn").addEventListener("click",()=>showScreen("Movements"));
    $("#incomeBtn").addEventListener("click",()=>openEntry("income"));
    $("#expenseBtn").addEventListener("click",()=>openEntry("expense"));
    $("#flashBtn").addEventListener("click",()=>openEntry("expense"));
    $("#transferBtn").addEventListener("click",()=>{
      fillAreaSelect($("#transferFrom"),currentArea==="Tudo"?"Pessoal":currentArea);
      fillAreaSelect($("#transferTo"),currentArea==="Trabalho"?"Pessoal":"Trabalho");
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
      fillAreaSelect($("#recArea"),currentArea==="Tudo"?"Pessoal":currentArea);openModal("recurringModal");
    });
    $("#saveRecurringBtn").addEventListener("click",saveRecurring);
    $("#exportBtn").addEventListener("click",exportBackup);
    $("#importInput").addEventListener("change",e=>{const f=e.target.files?.[0];if(f)importBackup(f);e.target.value="";});

    if("serviceWorker" in navigator){
      try{ await navigator.serviceWorker.register("./sw.js"); }catch(e){ console.warn("SW",e); }
    }
    await refreshAll();
  }

  init().catch(err=>{console.error(err);alert("Não foi possível iniciar o Meu Caixa. Recarregue a página.");});
})();
