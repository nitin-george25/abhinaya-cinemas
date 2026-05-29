/*
 * 03-fb.js
 * Phase A refactor: extracted verbatim from index.html.
 * F&B module — DSR upload, bulk multi-file, products catalog (block #2)
 *
 * Phase B notes:
 *   - Convert to ES module: replace globals with explicit import/export.
 *   - Pure functions (no DOM) → keep / move to js/engine/.
 *   - Render functions (touch DOM) → keep in this layer; become components later.
 */

(function(){
  function ready(fn){ if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }
  ready(function(){

    // ---- safety: ensure F&B arrays exist on S ----
    if(!Array.isArray(S.fbProducts)) S.fbProducts=[];
    if(!Array.isArray(S.fbEntries))  S.fbEntries =[];

    var syncedFB = {};       // entry_date -> signature (for cloud sync)
    var pendingDSR = null;   // parsed but not yet saved daily DSR
    var pendingCat = null;   // parsed but not yet committed catalog (preview pattern not used; we commit on upload)

    function uidL(){ return Math.random().toString(36).slice(2,9); }
    function esc(v){ return String(v==null?'':v).replace(/[&<>"']/g, function(c){ return ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]; }); }
    function fmt(n){ var x = Number(n); if(!isFinite(x)) x=0; return x.toLocaleString('en-IN',{maximumFractionDigits:2, minimumFractionDigits:2}); }
    function isOwnerNow(){ try{ var b=document.getElementById('dataBar'); return b && /\(owner\)/.test(b.textContent||''); }catch(e){ return false; } }
    function meEmail(){ try{ var b=document.getElementById('dataBar'); var m=(b&&b.textContent||'').match(/signed in as ([^\s]+)/); return m?m[1]:''; }catch(e){ return ''; } }

    // ---------- CSV parser (handles quoted fields w/ commas + escaped "") ----------
    function parseCSV(text){
      var rows=[], i=0, cell='', row=[], inQ=false;
      while(i<text.length){
        var c=text[i];
        if(inQ){
          if(c==='"' && text[i+1]==='"'){ cell+='"'; i+=2; continue; }
          if(c==='"'){ inQ=false; i++; continue; }
          cell+=c; i++; continue;
        }
        if(c==='"'){ inQ=true; i++; continue; }
        if(c===','){ row.push(cell); cell=''; i++; continue; }
        if(c==='\r'){ i++; continue; }
        if(c==='\n'){ row.push(cell); rows.push(row); row=[]; cell=''; i++; continue; }
        cell+=c; i++;
      }
      if(cell.length || row.length){ row.push(cell); rows.push(row); }
      return rows;
    }

    // Convert "27-05-2026" or "2026-05-27" or "27/05/2026" etc. to ISO YYYY-MM-DD
    function normDate(d){
      d = (d||'').trim();
      if(/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
      var m = d.match(/^(\d{2})[-\/](\d{2})[-\/](\d{4})$/);
      if(m) return m[3]+'-'+m[2]+'-'+m[1];
      m = d.match(/^(\d{4})[\/](\d{2})[\/](\d{2})$/);
      if(m) return m[1]+'-'+m[2]+'-'+m[3];
      m = d.match(/^(\d{4})\.(\d{2})\.(\d{2})$/);
      if(m) return m[1]+'-'+m[2]+'-'+m[3];
      return '';
    }

    // ---------- DSR parser ----------
    function parseDSR(text){
      var rows = parseCSV(text);
      var fromDate='', toDate='';
      var headerIdx=-1, headerRow=null;
      // find "From,<date>,To,<date>" and "Sl. No." header
      for(var i=0;i<rows.length;i++){
        var r = rows[i].map(function(x){return (x||'').trim();});
        if(!fromDate){
          for(var j=0;j<r.length-1;j++){
            if(r[j].toLowerCase()==='from' && r[j+2] && r[j+2].toLowerCase()==='to'){
              fromDate = normDate(r[j+1]); toDate = normDate(r[j+3]||''); break;
            }
          }
        }
        if(headerIdx<0 && r[0].toLowerCase().indexOf('sl. no')===0){ headerIdx=i; headerRow=r; }
      }
      if(!fromDate) throw new Error('Could not find the From/To date row in the CSV.');
      if(toDate && fromDate !== toDate) throw new Error('CSV covers a range ('+fromDate+' to '+toDate+'). Please upload one day at a time.');
      if(headerIdx<0) throw new Error('Could not find the item table header (Sl. No., Super Category, ...).');

      var H = headerRow.map(function(h){ return (h||'').trim().toLowerCase(); });
      function col(name){ return H.indexOf(name.toLowerCase()); }
      var iSl   = col('sl. no.');
      var iSup  = col('super category');
      var iCat  = col('category');
      var iName = col('item name');
      var iQty  = col('quantity');
      var iRate = col('rate');
      var iDisc = col('discount');
      var iComp = col('complimentary');
      var iProm = col('promotional');
      var iNet  = col('net amount');
      var iTax  = col('tax');
      var iTot  = col('total amount');
      if(iName<0 || iQty<0) throw new Error('Items table is missing required columns (Item Name, Quantity).');

      var items=[], summary={};
      // collect items until blank-ish row
      var k = headerIdx+1;
      for(; k<rows.length; k++){
        var rr = rows[k];
        var first = (rr[0]||'').trim();
        var name  = iName>=0 ? (rr[iName]||'').trim() : '';
        if(!first && !name) break; // blank separator
        if(!name) continue;        // skip rows without an item name
        items.push({
          sl: iSl>=0 ? Number(rr[iSl]||0)||0 : (items.length+1),
          superCategory: iSup>=0?(rr[iSup]||'').trim():'',
          category:      iCat>=0?(rr[iCat]||'').trim():'',
          name: name,
          qty:           Number((rr[iQty]||'0').replace(/,/g,''))||0,
          rate:          iRate>=0?Number((rr[iRate]||'0').replace(/,/g,''))||0:0,
          discount:      iDisc>=0?Number((rr[iDisc]||'0').replace(/,/g,''))||0:0,
          complimentary: iComp>=0?Number((rr[iComp]||'0').replace(/,/g,''))||0:0,
          promotional:   iProm>=0?Number((rr[iProm]||'0').replace(/,/g,''))||0:0,
          netAmount:     iNet >=0?Number((rr[iNet ]||'0').replace(/,/g,''))||0:0,
          tax:           iTax >=0?Number((rr[iTax ]||'0').replace(/,/g,''))||0:0,
          totalAmount:   iTot >=0?Number((rr[iTot ]||'0').replace(/,/g,''))||0:0,
        });
      }

      // footer key/value rows
      function num(v){ return Number(String(v||'0').replace(/,/g,''))||0; }
      for(; k<rows.length; k++){
        var rr2 = rows[k];
        var key = (rr2[0]||'').trim().toLowerCase();
        var val = (rr2[1]||'').trim();
        if(!key) continue;
        if(key==='bills')                          summary.bills              = num(val);
        else if(key==='take away')                 summary.takeAway           = num(val);
        else if(key==='gross sales')               summary.grossSales         = num(val);
        else if(key==='complimentary')             summary.complimentary      = num(val);
        else if(key==='discount')                  summary.discount           = num(val);
        else if(key.indexOf('average per cover')===0) summary.avgPerCover     = num(val);
        else if(key.indexOf('apt')===0)            summary.apt                = num(val);
        else if(key.indexOf('promotional')===0)    summary.promotional        = num(val);
        else if(key==='food sales')                summary.foodSales          = num(val);
        else if(key==='beverages sales')           summary.beveragesSales     = num(val);
        else if(key==='net sales without tax')     summary.netSalesWithoutTax = num(val);
        else if(key==='add tax')                   summary.addTax             = num(val);
        else if(key==='net sales with tax')        summary.netSalesWithTax    = num(val);
      }

      // sanity totals — if footer not present, compute from items
      if(summary.grossSales===undefined){
        var sum=0; items.forEach(function(it){ sum += (it.totalAmount||0); }); summary.grossSales = Math.round(sum*100)/100;
      }
      if(summary.netSalesWithoutTax===undefined){
        var sum2=0; items.forEach(function(it){ sum2 += (it.netAmount||0); }); summary.netSalesWithoutTax = Math.round(sum2*100)/100;
      }
      if(summary.addTax===undefined){
        var sum3=0; items.forEach(function(it){ sum3 += (it.tax||0); }); summary.addTax = Math.round(sum3*100)/100;
      }

      return { date: fromDate, items: items, summary: summary };
    }

    // ---------- items.csv (catalog) parser ----------
    function parseCatalog(text){
      var rows = parseCSV(text);
      if(!rows.length) throw new Error('CSV is empty.');
      var H = rows[0].map(function(h){ return (h||'').trim().toLowerCase(); });
      function col(n){ return H.indexOf(n.toLowerCase()); }
      var iNum = col('itemnumber');
      var iName= col('item name');
      var iUid = col('uid');
      var iRate= col('rate');
      var iCat = col('category name');
      var iSup = col('supercategory name');
      var iNV  = col('non veg');
      if(iName<0) throw new Error('items.csv is missing the "Item Name" column.');
      var out=[];
      for(var i=1;i<rows.length;i++){
        var r=rows[i];
        if(!r || !r.length) continue;
        var name = iName>=0 ? (r[iName]||'').trim() : '';
        if(!name) continue;
        out.push({
          id: uidL(),
          itemNumber: iNum>=0?(r[iNum]||'').trim():'',
          name: name,
          uid: iUid>=0?(r[iUid]||'').trim():'',
          rate: iRate>=0?Number((r[iRate]||'0').replace(/,/g,''))||0:0,
          category: iCat>=0?(r[iCat]||'').trim():'',
          superCategory: iSup>=0?(r[iSup]||'').trim():'',
          nonVeg: iNV>=0?(String(r[iNV]||'').trim()==='1'):false,
        });
      }
      return out;
    }

    // expose parser for bulk uploader
    window.__parseDSR = parseDSR;

    // ---------- DSR upload UI ----------
    document.addEventListener('click', function(e){
      if(e.target.id==='fbDsrUpload'){ document.getElementById('fbDsrFile').click(); }
      if(e.target.id==='fbDsrClear'){
        pendingDSR=null;
        document.getElementById('fbDsrPreview').innerHTML='';
        document.getElementById('fbDsrImport').style.display='none';
        e.target.style.display='none';
      }
      if(e.target.id==='fbDsrImport'){
        if(!pendingDSR){ return; }
        var existing = S.fbEntries.find(function(x){return x.date===pendingDSR.date;});
        var verb = existing ? 'REPLACE the existing F&B entry' : 'Save the F&B entry';
        if(!confirm(verb+' for '+pendingDSR.date+'? Items: '+pendingDSR.items.length+', net sales with tax: ₹'+fmt(pendingDSR.summary.netSalesWithTax||0)+'.')) return;
        if(existing){
          existing.items = pendingDSR.items;
          existing.summary = pendingDSR.summary;
        } else {
          S.fbEntries.push({ id: uidL(), date: pendingDSR.date, items: pendingDSR.items, summary: pendingDSR.summary, notes: '' });
        }
        pendingDSR=null;
        document.getElementById('fbDsrPreview').innerHTML='<span style="color:#2a8">Saved. Syncing to the cloud…</span>';
        document.getElementById('fbDsrImport').style.display='none';
        document.getElementById('fbDsrClear').style.display='none';
        if(typeof save==='function') save();
        renderHistory();
      }
    });

    document.addEventListener('change', function(e){
      if(e.target.id==='fbDsrFile'){
        var f = e.target.files && e.target.files[0]; if(!f) return;
        var rd = new FileReader();
        rd.onload = function(){
          try{
            var parsed = parseDSR(rd.result);
            pendingDSR = parsed;
            var existing = S.fbEntries.find(function(x){return x.date===parsed.date;});
            var note = existing ? '<span style="color:#c80"><b>Warning:</b> a day is already saved for '+parsed.date+'. Saving will replace it.</span><br>' : '';
            var summaryRows = [
              ['Bills', parsed.summary.bills],
              ['Take Away', parsed.summary.takeAway],
              ['Gross Sales', '₹ '+fmt(parsed.summary.grossSales)],
              ['Food Sales', '₹ '+fmt(parsed.summary.foodSales)],
              ['Beverages Sales', '₹ '+fmt(parsed.summary.beveragesSales)],
              ['Net Sales (no tax)', '₹ '+fmt(parsed.summary.netSalesWithoutTax)],
              ['Tax', '₹ '+fmt(parsed.summary.addTax)],
              ['Net Sales (with tax)', '₹ '+fmt(parsed.summary.netSalesWithTax)],
            ];
            var html = note + '<b>Date:</b> '+parsed.date+' &nbsp; <b>Items:</b> '+parsed.items.length+'<br><br>';
            html += '<table class="grid" style="max-width:520px">';
            summaryRows.forEach(function(row){ if(row[1]!==undefined) html += '<tr><td>'+esc(row[0])+'</td><td style="text-align:right">'+esc(row[1])+'</td></tr>'; });
            html += '</table>';
            document.getElementById('fbDsrPreview').innerHTML = html;
            document.getElementById('fbDsrImport').style.display = '';
            document.getElementById('fbDsrClear').style.display = '';
          }catch(err){
            document.getElementById('fbDsrPreview').innerHTML = '<span style="color:#c00"><b>Couldn\'t read that CSV:</b> '+esc(err.message)+'</span>';
            document.getElementById('fbDsrImport').style.display = 'none';
            document.getElementById('fbDsrClear').style.display = '';
          }
          e.target.value='';
        };
        rd.readAsText(f);
      }

      if(e.target.id==='fbCatFile'){
        if(!isOwnerNow()){ alert('Only the owner can update the F&B product catalog.'); e.target.value=''; return; }
        var f2 = e.target.files && e.target.files[0]; if(!f2) return;
        var rd2 = new FileReader();
        rd2.onload = function(){
          try{
            var list = parseCatalog(rd2.result);
            if(!list.length){ alert('No products found in that CSV.'); return; }
            if(!confirm('Replace the current F&B catalog ('+S.fbProducts.length+' products) with '+list.length+' product(s) from this file?')) return;
            var msg = document.getElementById('fbCatMsg');
            if(msg){ msg.textContent = 'Uploading…'; }
            replaceProducts(list).then(function(){
              if(msg){ msg.textContent = 'Catalog replaced ('+list.length+' products).'; setTimeout(function(){ msg.textContent=''; }, 4000); }
              renderProducts();
            }).catch(function(err){
              alert('Catalog upload failed: '+(err && err.message || err));
              if(msg) msg.textContent = '';
            });
          }catch(err){ alert('Could not read items.csv: '+err.message); }
          e.target.value='';
        };
        rd2.readAsText(f2);
      }
    });

    document.addEventListener('click', function(e){
      if(e.target.id==='fbCatUpload'){
        if(!isOwnerNow()){ alert('Only the owner can update the F&B product catalog.'); return; }
        document.getElementById('fbCatFile').click();
      }
    });

    // ---------- Catalog table ----------
    function renderProducts(){
      var t = document.getElementById('fbProductsTable'); if(!t) return;
      var owner = isOwnerNow();
      var bar = document.getElementById('fbCatToolbar');
      if(bar){
        var btn = document.getElementById('fbCatUpload');
        if(btn) btn.style.display = owner ? '' : 'none';
      }
      var html = '<tr><th>Item #</th><th>Name</th><th>Category</th><th>Rate</th></tr>';
      if(!S.fbProducts.length){
        html += '<tr><td colspan="4" style="opacity:.6">No products yet. '+(owner?'Upload items.csv above.':'Ask the owner to upload items.csv.')+'</td></tr>';
      } else {
        S.fbProducts.slice(0,500).forEach(function(p){
          html += '<tr>'+
            '<td>'+esc(p.itemNumber||p.uid||'')+'</td>'+
            '<td>'+esc(p.name)+'</td>'+
            '<td>'+esc((p.superCategory?(p.superCategory+' / '):'')+(p.category||''))+'</td>'+
            '<td style="text-align:right">₹ '+fmt(p.rate||0)+'</td>'+
          '</tr>';
        });
        if(S.fbProducts.length>500){
          html += '<tr><td colspan="4" style="opacity:.6">… +'+(S.fbProducts.length-500)+' more (showing first 500)</td></tr>';
        }
      }
      t.innerHTML = html;
    }

    // ---------- History ----------
    function renderHistory(){
      var t = document.getElementById('fbHistoryTable'); if(!t) return;
      var rows = S.fbEntries.slice().sort(function(a,b){ return (b.date||'').localeCompare(a.date||''); });
      var html = '<tr><th>Date</th><th>Bills</th><th>Items</th><th>Gross</th><th>Tax</th><th>Net (with tax)</th><th></th></tr>';
      if(!rows.length){
        html += '<tr><td colspan="7" style="opacity:.6">No F&B days saved yet. Upload a DSR CSV above to start.</td></tr>';
      } else {
        rows.forEach(function(r){
          var sm = r.summary||{};
          html += '<tr>'+
            '<td>'+esc(r.date)+'</td>'+
            '<td style="text-align:right">'+esc(sm.bills==null?'—':sm.bills)+'</td>'+
            '<td style="text-align:right">'+(r.items||[]).length+'</td>'+
            '<td style="text-align:right">₹ '+fmt(sm.grossSales||0)+'</td>'+
            '<td style="text-align:right">₹ '+fmt(sm.addTax||0)+'</td>'+
            '<td style="text-align:right">₹ '+fmt(sm.netSalesWithTax|| (sm.grossSales||0)+(sm.addTax||0))+'</td>'+
            '<td><button class="btn ghost sm" data-fbview="'+esc(r.date)+'">View</button> <button class="btn ghost sm" data-fbdel="'+esc(r.date)+'">Delete</button></td>'+
          '</tr>';
        });
      }
      t.innerHTML = html;
    }

    document.addEventListener('click', function(e){
      if(e.target.dataset && e.target.dataset.fbview){
        var d = e.target.dataset.fbview;
        var rec = S.fbEntries.find(function(x){return x.date===d;});
        var det = document.getElementById('fbDayDetail'); if(!det || !rec) return;
        var sm = rec.summary||{};
        var html = '<h3 style="margin:0 0 8px">F&amp;B detail — '+esc(d)+'</h3>';
        html += '<div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:10px;font-size:13.5px">';
        html += '<div><b>Bills:</b> '+esc(sm.bills==null?'—':sm.bills)+'</div>';
        html += '<div><b>Take Away:</b> '+esc(sm.takeAway==null?'—':sm.takeAway)+'</div>';
        html += '<div><b>Gross:</b> ₹'+fmt(sm.grossSales||0)+'</div>';
        html += '<div><b>Food:</b> ₹'+fmt(sm.foodSales||0)+'</div>';
        html += '<div><b>Bev:</b> ₹'+fmt(sm.beveragesSales||0)+'</div>';
        html += '<div><b>Tax:</b> ₹'+fmt(sm.addTax||0)+'</div>';
        html += '<div><b>Net w/ Tax:</b> ₹'+fmt(sm.netSalesWithTax||0)+'</div>';
        html += '</div>';
        html += '<div class="grid-wrap"><table class="grid"><tr><th>#</th><th>Category</th><th>Item</th><th>Qty</th><th>Rate</th><th>Net</th><th>Tax</th><th>Total</th></tr>';
        (rec.items||[]).forEach(function(it){
          html += '<tr>'+
            '<td>'+esc(it.sl||'')+'</td>'+
            '<td>'+esc((it.superCategory?(it.superCategory+' / '):'')+(it.category||''))+'</td>'+
            '<td>'+esc(it.name)+'</td>'+
            '<td style="text-align:right">'+esc(it.qty)+'</td>'+
            '<td style="text-align:right">'+fmt(it.rate||0)+'</td>'+
            '<td style="text-align:right">'+fmt(it.netAmount||0)+'</td>'+
            '<td style="text-align:right">'+fmt(it.tax||0)+'</td>'+
            '<td style="text-align:right">'+fmt(it.totalAmount||0)+'</td>'+
          '</tr>';
        });
        html += '</table></div>';
        html += '<div class="toolbar" style="margin-top:8px"><button class="btn ghost sm" id="fbCloseDetail">Close</button></div>';
        det.innerHTML = html;
        det.style.display = '';
        try{ det.scrollIntoView({behavior:'smooth', block:'start'}); }catch(_){}
      }
      if(e.target.id==='fbCloseDetail'){
        var det2 = document.getElementById('fbDayDetail');
        if(det2){ det2.style.display='none'; det2.innerHTML=''; }
      }
      if(e.target.dataset && e.target.dataset.fbdel){
        var dd = e.target.dataset.fbdel;
        if(!confirm('Delete the F&B entry for '+dd+' permanently? It will be removed from the cloud for everyone and cannot be undone.')) return;
        S.fbEntries = S.fbEntries.filter(function(x){return x.date!==dd;});
        var det3 = document.getElementById('fbDayDetail'); if(det3){ det3.style.display='none'; det3.innerHTML=''; }
        if(typeof save==='function') save();
        renderHistory();
      }
    });

    // ---------- Cloud sync for fb_entries ----------
    function fbSig(e){ return JSON.stringify({ items:e.items||[], summary:e.summary||{}, notes:e.notes||'' }); }

    function pullFB(){
      var sb = window._sb; if(!sb) return Promise.resolve();
      if(window.__DCR_ROLE==='accountant') return Promise.resolve();
      return sb.from('fb_entries').select('*').then(function(r){
        if(r.error){ console.error('fb pull', r.error); return; }
        var rows = r.data||[];
        S.fbEntries = rows.map(function(x){
          return { id: uidL(), date: x.entry_date, items: x.items||[], summary: x.summary||{}, notes: x.notes||'' };
        });
        syncedFB = {};
        S.fbEntries.forEach(function(e){ syncedFB[e.date] = fbSig(e); });
        renderHistory();
      });
    }

    function pushFB(){
      var sb = window._sb; if(!sb) return;
      if(window.__DCR_ROLE==='accountant') return;
      var me = meEmail();
      var ops=[], curKeys={};
      S.fbEntries.forEach(function(e){
        if(!e.date) return;
        curKeys[e.date]=true;
        var sig = fbSig(e);
        if(syncedFB[e.date] !== sig){
          ops.push(
            sb.from('fb_entries').upsert(
              { entry_date:e.date, items:e.items||[], summary:e.summary||{}, notes:e.notes||'', updated_by: me, updated_at: new Date().toISOString() },
              { onConflict:'entry_date' }
            ).then(function(rr){ if(rr.error) console.error('fb upsert', rr.error); else syncedFB[e.date]=sig; })
          );
        }
      });
      Object.keys(syncedFB).forEach(function(k){
        if(!curKeys[k]){
          ops.push(
            sb.from('fb_entries').delete().match({ entry_date:k })
              .then(function(rr){ if(rr.error) console.error('fb delete', rr.error); else delete syncedFB[k]; })
          );
        }
      });
      return Promise.all(ops);
    }


    // ============ F&B products catalog (fb_products table) ============
    function fbProductFromRow(p){
      return {
        id: p.id,
        name: p.name || '',
        defaultPrice: p.default_rate==null ? '' : Number(p.default_rate),
        gstPct: p.default_gst_pct==null ? 5 : Number(p.default_gst_pct),
        category: p.category || '',
        superCategory: p.super_category || '',
        itemNumber: p.pos_item_number || '',
        nonVeg: !!p.is_non_veg,
        isActive: p.is_active !== false
      };
    }
    function fbProductToRow(p){
      return {
        name: (p.name || '').trim(),
        default_rate: p.defaultPrice==='' || p.defaultPrice==null ? 0 : Number(p.defaultPrice),
        default_gst_pct: p.gstPct==='' || p.gstPct==null ? 5 : Number(p.gstPct),
        category: p.category || '',
        super_category: p.superCategory || '',
        pos_item_number: p.itemNumber || null,
        is_non_veg: !!p.nonVeg,
        is_active: p.isActive !== false,
        updated_at: new Date().toISOString()
      };
    }

    function pullProducts(){
      var sb = window._sb; if(!sb) return Promise.resolve();
      window.__pullProducts = pullProducts;
      return sb.from('fb_products').select('*').order('category').order('name').then(function(r){
        if(r.error){ console.warn('fb_products not available yet (run Step 4 SQL)', r.error.message); return; }
        if(r.data && r.data.length){
          S.fbProducts = r.data.map(fbProductFromRow);
        } else if(!Array.isArray(S.fbProducts)){
          S.fbProducts = [];
        }
        if(typeof renderProducts==='function') renderProducts();
      });
    }

    // Replace the entire catalog with `list` — used by the items.csv upload.
    function replaceProducts(list){
      var sb = window._sb; if(!sb) return Promise.reject(new Error('No client'));
      if(window.__DCR_ROLE==='accountant') return Promise.reject(new Error('Read-only'));
      // Delete all then insert in batches.
      return sb.from('fb_products').delete().neq('id','00000000-0000-0000-0000-000000000000').then(function(d){
        if(d.error) throw d.error;
        if(!list.length) return { data: [] };
        var rows = list.map(fbProductToRow);
        // Insert in chunks of 200
        var chunks = [];
        for(var i=0;i<rows.length;i+=200) chunks.push(rows.slice(i, i+200));
        var p = Promise.resolve();
        chunks.forEach(function(c){
          p = p.then(function(){ return sb.from('fb_products').insert(c); });
        });
        return p;
      }).then(function(){ return pullProducts(); });
    }

    function deleteProduct(id){
      var sb = window._sb; if(!sb) return Promise.reject(new Error('No client'));
      if(window.__DCR_ROLE==='accountant') return Promise.reject(new Error('Read-only'));
      return sb.from('fb_products').delete().eq('id', id).then(function(){ return pullProducts(); });
    }

    function upsertProduct(p){
      var sb = window._sb; if(!sb) return Promise.reject(new Error('No client'));
      if(window.__DCR_ROLE==='accountant') return Promise.reject(new Error('Read-only'));
      var row = fbProductToRow(p);
      // Upsert by name (case-insensitive — we have a unique index on lower(name))
      return sb.from('fb_products').upsert(row, { onConflict: 'name' }).then(function(){ return pullProducts(); });
    }

    function subscribeProducts(){
      var sb = window._sb; if(!sb || !sb.channel) return;
      try{
        sb.channel('fb-products-sync')
          .on('postgres_changes',{ event:'*', schema:'public', table:'fb_products' }, function(){
            clearTimeout(window.__fbPdtPullTimer);
            window.__fbPdtPullTimer = setTimeout(function(){ pullProducts(); }, 500);
          })
          .subscribe();
      }catch(e){ console.error('fb-products subscribe', e); }
    }

    // Expose for the items.csv upload handler to call
    window.__replaceFbProducts = replaceProducts;

    function subscribeFB(){
      var sb = window._sb; if(!sb || !sb.channel) return;
      try{
        sb.channel('fb-sync')
          .on('postgres_changes',{ event:'*', schema:'public', table:'fb_entries' }, function(){
            clearTimeout(window.__fbPullTimer);
            window.__fbPullTimer = setTimeout(function(){ pullFB(); }, 600);
          })
          .subscribe();
      }catch(e){ console.error('fb subscribe', e); }
    }

    // Hook into the app's save() flow without overwriting it
    var origCloudOnSave = window.cloudOnSave;
    window.cloudOnSave = function(){
      if(typeof origCloudOnSave==='function'){ try{ origCloudOnSave.apply(this, arguments); }catch(e){ console.error(e); } }
      clearTimeout(window.__fbPushTimer);
      window.__fbPushTimer = setTimeout(function(){ try{ pushFB(); }catch(e){ console.error(e); } }, 1100);
    };

    function tryBoot(){
      var sb = window._sb;
      if(!sb){ setTimeout(tryBoot, 400); return; }
      sb.auth.getUser().then(function(res){
        var u = res && res.data && res.data.user;
        if(!u){ setTimeout(tryBoot, 800); return; }
        Promise.all([pullFB(), pullProducts()]).then(function(){ subscribeFB(); subscribeProducts(); });
      }).catch(function(){ setTimeout(tryBoot, 800); });
      try{
        sb.auth.onAuthStateChange(function(evt){
          if(evt==='SIGNED_IN'){ Promise.all([pullFB(), pullProducts()]).then(function(){ subscribeFB(); subscribeProducts(); }); }
        });
      }catch(_){}
    }
    tryBoot();

    // ---------- Public entry-point ----------
    window.renderFB = function(){
      renderHistory();
      renderProducts();
    };

  });
})();
