/*
 * 07-dashboard.js
 * Phase A refactor: extracted verbatim from index.html.
 * Owner's Dashboard — KPIs, charts, period selector (block #6)
 *
 * Phase B notes:
 *   - Convert to ES module: replace globals with explicit import/export.
 *   - Pure functions (no DOM) → keep / move to js/engine/.
 *   - Render functions (touch DOM) → keep in this layer; become components later.
 */

(function(){
  function ready(fn){ if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }
  ready(function(){

    // ---- State ----
    var state = {
      preset: 'last30',         // 'last7' | 'last30' | 'last90' | 'thisMonth' | 'all' | 'custom'
      from: null,               // ISO 'YYYY-MM-DD'
      to: null
    };
    var charts = {};            // chart.js instances we may need to destroy
    var COLORS = {
      blue:'#3488C0', amber:'#F7B61F', red:'#F93820', green:'#39B54A',
      muted:'#9aa0a6', soft:'#e8eaed', ink:'#181818'
    };
    var CAT_PALETTE = ['#3488C0','#F7B61F','#F93820','#39B54A','#9B59B6','#16A085','#E67E22','#7F8C8D'];

    function iso(d){ return d.toISOString().slice(0,10); }
    function dt(s){ if(!s) return null; var p=s.split('-'); return new Date(+p[0], +p[1]-1, +p[2]); }
    function addDays(d, n){ var x=new Date(d.getTime()); x.setDate(x.getDate()+n); return x; }
    function daysBetween(a, b){ return Math.round((b - a) / 86400000) + 1; }
    function fmtINR(n, dec){
      var x=Number(n); if(!isFinite(x)) x=0;
      return '₹ '+x.toLocaleString('en-IN',{maximumFractionDigits: dec==null?0:dec, minimumFractionDigits: dec==null?0:dec});
    }
    function fmtInt(n){ var x=Number(n)||0; return x.toLocaleString('en-IN'); }
    function pctDelta(cur, prev){
      if(prev==null || prev===0) return null;
      return (cur - prev) / prev * 100;
    }

    // ---- Date range resolution ----
    function resolveRange(){
      var today = new Date(); today.setHours(0,0,0,0);
      if(state.preset==='last7')   { state.from = iso(addDays(today,-6));  state.to = iso(today); }
      else if(state.preset==='last30')  { state.from = iso(addDays(today,-29)); state.to = iso(today); }
      else if(state.preset==='last90')  { state.from = iso(addDays(today,-89)); state.to = iso(today); }
      else if(state.preset==='thisMonth'){ var f=new Date(today.getFullYear(), today.getMonth(), 1); state.from=iso(f); state.to=iso(today); }
      else if(state.preset==='all'){
        // Span the dataset
        var allDates = [];
        (S.entries||[]).forEach(function(e){ if(e.date) allDates.push(e.date); });
        (S.fbEntries||[]).forEach(function(e){ if(e.date) allDates.push(e.date); });
        if(allDates.length){
          allDates.sort();
          state.from = allDates[0]; state.to = allDates[allDates.length-1];
        } else { state.from = iso(today); state.to = iso(today); }
      }
      // custom: from/to set by inputs already
    }

    // ---- BO per-entry computation (using existing engine) ----
    function safeCompute(en){
      try { return computeEntry(en); } catch(e){ return null; }
    }

    // Get BO daily aggregate: {date -> {audience, gross, netShare, shows, movies}}
    function aggregateBO(from, to){
      var byDate = {};
      (S.entries||[]).forEach(function(en){
        if(!en.date || en.date < from || en.date > to) return;
        var C = safeCompute(en);
        if(!C) return;
        var today = C.today || {};
        if(!byDate[en.date]) byDate[en.date] = { audience:0, gross:0, netShare:0, distShare:0, exShare:0, shows:0, movieSet:{}, movieByGross:{} };
        byDate[en.date].audience += today.audience || 0;
        byDate[en.date].gross    += today.grossColl || 0;
        byDate[en.date].netShare += today.netShare || 0;
        byDate[en.date].distShare+= today.distShare || 0;
        byDate[en.date].exShare  += today.exShare || 0;
        byDate[en.date].shows    += (en.shows||[]).length;
        if(en.movieId) byDate[en.date].movieSet[en.movieId] = (byDate[en.date].movieSet[en.movieId]||0) + (today.grossColl || 0);
      });
      return byDate;
    }

    // Per-movie audience+gross over the period (for top movies if needed later)
    function aggregateBOByMovie(from, to){
      var byMovie = {};
      (S.entries||[]).forEach(function(en){
        if(!en.date || en.date < from || en.date > to) return;
        var C = safeCompute(en); if(!C) return;
        var movieName = (C.movie && C.movie.name) || en.movieId || '?';
        if(!byMovie[movieName]) byMovie[movieName] = { audience:0, gross:0 };
        byMovie[movieName].audience += (C.today||{}).audience || 0;
        byMovie[movieName].gross    += (C.today||{}).grossColl || 0;
      });
      return byMovie;
    }

    // F&B daily aggregate from fbEntries (already summarised)
    function aggregateFB(from, to){
      var byDate = {};
      (S.fbEntries||[]).forEach(function(e){
        if(!e.date || e.date < from || e.date > to) return;
        var sm = e.summary || {};
        byDate[e.date] = {
          gross: sm.grossSales || 0,
          food: sm.foodSales || 0,
          bev: sm.beveragesSales || 0,
          tax: sm.addTax || 0,
          total: sm.netSalesWithTax || 0,
          bills: sm.bills==null ? null : Number(sm.bills),
          items: e.items || []
        };
      });
      return byDate;
    }

    // F&B item aggregate over period — for top items & category mix
    function aggregateFBItems(from, to){
      var byItem = {};   // name -> {qty, net, cat}
      var byCat  = {};   // category -> net
      (S.fbEntries||[]).forEach(function(e){
        if(!e.date || e.date < from || e.date > to) return;
        (e.items||[]).forEach(function(it){
          var nm = it.name || '?';
          if(!byItem[nm]) byItem[nm] = { qty:0, net:0, cat:(it.category||'') };
          byItem[nm].qty += Number(it.qty)||0;
          byItem[nm].net += Number(it.netAmount)||0;
          var c = it.category || 'Uncategorised';
          byCat[c] = (byCat[c] || 0) + (Number(it.netAmount) || 0);
        });
      });
      return { byItem: byItem, byCat: byCat };
    }

    function buildDateList(from, to){
      var list = []; var d = dt(from); var end = dt(to);
      while(d <= end){ list.push(iso(d)); d = addDays(d, 1); }
      return list;
    }

    // ---- Period totals + KPIs ----
    function periodTotals(boDaily, fbDaily){
      var t = { bo_gross:0, bo_audience:0, bo_netShare:0, fb_net:0, fb_total:0, fb_bills:0, fb_days:0, bo_days:0, combined:0 };
      Object.keys(boDaily).forEach(function(d){
        t.bo_days++; t.bo_gross += boDaily[d].gross; t.bo_audience += boDaily[d].audience;
        t.bo_netShare += boDaily[d].netShare;
      });
      Object.keys(fbDaily).forEach(function(d){
        t.fb_days++; t.fb_net += fbDaily[d].gross; t.fb_total += fbDaily[d].total;
        if(fbDaily[d].bills != null) t.fb_bills += fbDaily[d].bills;
      });
      t.combined = t.bo_gross + t.fb_net;
      t.sph_ex_tax = t.bo_audience > 0 ? (t.fb_net / t.bo_audience) : null;
      return t;
    }

    // ---- Render KPI cards ----
    function renderKPIs(cur, prev){
      function delta(curVal, prevVal, fmt){
        var d = pctDelta(curVal, prevVal);
        if(d==null) return '<span style="opacity:.55">no prior period data</span>';
        var color = d >= 0 ? '#2a8' : '#c33';
        var arrow = d >= 0 ? '▲' : '▼';
        var prevStr = fmt ? fmt(prevVal) : prevVal;
        return '<span style="color:'+color+'">'+arrow+' '+Math.abs(d).toFixed(1)+'%</span> <span style="opacity:.55">vs '+prevStr+'</span>';
      }
      function card(title, value, sub){
        return '<div class="dash-card"><h3>'+title+'</h3><div class="dash-num">'+value+'</div><div class="dash-sub">'+sub+'</div></div>';
      }
      var grid = document.getElementById('dashKpiGrid'); if(!grid) return;
      var cards = [];
      cards.push(card('BO Gross', fmtINR(cur.bo_gross), delta(cur.bo_gross, prev.bo_gross, fmtINR)));
      cards.push(card('Audience', fmtInt(cur.bo_audience), delta(cur.bo_audience, prev.bo_audience, fmtInt)));
      cards.push(card('F&B Net', fmtINR(cur.fb_net), delta(cur.fb_net, prev.fb_net, fmtINR)));
      cards.push(card('F&B Bills', fmtInt(cur.fb_bills), delta(cur.fb_bills, prev.fb_bills, fmtInt)));
      var sphStr = cur.sph_ex_tax==null ? '—' : fmtINR(cur.sph_ex_tax, 2);
      cards.push(card('SPH (ex-tax)', sphStr, delta(cur.sph_ex_tax, prev.sph_ex_tax, function(v){ return v==null?'—':fmtINR(v,2); })));
      cards.push(card('Combined Revenue', fmtINR(cur.combined), delta(cur.combined, prev.combined, fmtINR)));
      grid.innerHTML = cards.join('');
    }

    // ---- Charts ----
    function destroyChart(name){ if(charts[name]){ charts[name].destroy(); charts[name] = null; } }

    function renderRevenueChart(dates, boDaily, fbDaily){
      destroyChart('rev');
      var ctx = document.getElementById('dashChartRevenue'); if(!ctx) return;
      var boVals = dates.map(function(d){ return (boDaily[d]||{gross:0}).gross || 0; });
      var fbVals = dates.map(function(d){ return (fbDaily[d]||{gross:0}).gross || 0; });
      charts.rev = new Chart(ctx, {
        type:'bar',
        data:{
          labels: dates,
          datasets:[
            { label:'BO Gross', data: boVals, backgroundColor: COLORS.blue, stack:'rev' },
            { label:'F&B Net',  data: fbVals, backgroundColor: COLORS.amber, stack:'rev' }
          ]
        },
        options:{
          responsive:true, maintainAspectRatio:false,
          scales:{
            x:{ stacked:true, ticks:{ maxRotation: 60, minRotation: 60, autoSkip: true, font:{size:10} }, grid:{display:false} },
            y:{ stacked:true, ticks:{ callback:function(v){ return '₹'+(v/1000).toFixed(0)+'k'; }, font:{size:11} }, grid:{color:'#f1f1f1'} }
          },
          plugins:{
            legend:{ position:'top', labels:{boxWidth:14, font:{size:12}} },
            tooltip:{
              callbacks:{
                label:function(ctx){ return ctx.dataset.label+': '+fmtINR(ctx.parsed.y); },
                footer:function(items){ var t=items.reduce(function(s,i){return s+i.parsed.y;},0); return 'Total: '+fmtINR(t); }
              }
            }
          }
        }
      });
    }

    function renderSphChart(dates, boDaily, fbDaily){
      destroyChart('sph');
      var ctx = document.getElementById('dashChartSph'); if(!ctx) return;
      var vals = dates.map(function(d){
        var bo = boDaily[d]; var fb = fbDaily[d];
        if(!bo || !fb || !bo.audience) return null;
        return Math.round((fb.gross / bo.audience) * 100) / 100;
      });
      charts.sph = new Chart(ctx, {
        type:'line',
        data:{ labels: dates, datasets:[{ label:'SPH (₹/head)', data: vals, borderColor: COLORS.red, backgroundColor:'rgba(249,56,32,0.08)', tension:0.3, spanGaps:true, pointRadius:2, fill:true }] },
        options:{
          responsive:true, maintainAspectRatio:false,
          scales:{
            x:{ ticks:{ maxRotation:60, minRotation:60, autoSkip:true, font:{size:10} }, grid:{display:false} },
            y:{ ticks:{ callback:function(v){ return '₹'+v; }, font:{size:11} }, grid:{color:'#f1f1f1'} }
          },
          plugins:{
            legend:{ display:false },
            tooltip:{ callbacks:{ label:function(c){ return c.parsed.y==null ? 'No data' : ('SPH: '+fmtINR(c.parsed.y,2)); } } }
          }
        }
      });
    }

    function renderTopItemsChart(itemMap){
      destroyChart('top');
      var ctx = document.getElementById('dashChartTopItems'); if(!ctx) return;
      var list = Object.keys(itemMap).map(function(k){ return { name:k, qty:itemMap[k].qty, net:itemMap[k].net }; });
      list.sort(function(a,b){ return b.net - a.net; });
      list = list.slice(0, 10);
      charts.top = new Chart(ctx, {
        type:'bar',
        data:{
          labels: list.map(function(x){ return x.name; }),
          datasets:[{
            label:'Net sales',
            data: list.map(function(x){ return Math.round(x.net); }),
            backgroundColor: COLORS.blue
          }]
        },
        options:{
          indexAxis:'y',
          responsive:true, maintainAspectRatio:false,
          scales:{
            x:{ ticks:{ callback:function(v){ return '₹'+(v/1000).toFixed(0)+'k'; }, font:{size:10} }, grid:{color:'#f1f1f1'} },
            y:{ ticks:{font:{size:11}}, grid:{display:false} }
          },
          plugins:{
            legend:{ display:false },
            tooltip:{
              callbacks:{
                label:function(ctx){
                  var item = list[ctx.dataIndex];
                  return [fmtINR(item.net), fmtInt(item.qty)+' units sold'];
                }
              }
            }
          }
        }
      });
    }

    function renderCategoriesChart(catMap){
      destroyChart('cat');
      var ctx = document.getElementById('dashChartCategories'); if(!ctx) return;
      var entries = Object.keys(catMap).map(function(k){ return [k, catMap[k]]; }).sort(function(a,b){ return b[1]-a[1]; });
      var labels = entries.map(function(e){ return e[0]; });
      var vals = entries.map(function(e){ return Math.round(e[1]); });
      var total = vals.reduce(function(a,b){return a+b;},0);
      charts.cat = new Chart(ctx, {
        type:'doughnut',
        data:{ labels: labels, datasets:[{ data: vals, backgroundColor: labels.map(function(_, i){ return CAT_PALETTE[i % CAT_PALETTE.length]; }), borderWidth:1, borderColor:'#fff' }] },
        options:{
          responsive:true, maintainAspectRatio:false, cutout:'55%',
          plugins:{
            legend:{ position:'right', labels:{boxWidth:14, font:{size:12}} },
            tooltip:{
              callbacks:{
                label:function(ctx){
                  var v = ctx.parsed; var pct = total>0 ? (v/total*100).toFixed(1) : '0.0';
                  return ctx.label+': '+fmtINR(v)+' ('+pct+'%)';
                }
              }
            }
          }
        }
      });
    }

    function renderDowChart(dates, boDaily, fbDaily){
      destroyChart('dow');
      var ctx = document.getElementById('dashChartDow'); if(!ctx) return;
      var DOW_LABELS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
      var sums = [0,0,0,0,0,0,0]; var counts = [0,0,0,0,0,0,0];
      dates.forEach(function(d){
        var dow = (dt(d).getDay() + 6) % 7;  // Mon=0
        var rev = ((boDaily[d]||{}).gross || 0) + ((fbDaily[d]||{}).gross || 0);
        if(rev > 0){ sums[dow] += rev; counts[dow]++; }
      });
      var avgs = sums.map(function(s, i){ return counts[i]>0 ? Math.round(s/counts[i]) : 0; });
      charts.dow = new Chart(ctx, {
        type:'bar',
        data:{ labels: DOW_LABELS, datasets:[{ label:'Avg combined revenue', data: avgs, backgroundColor: COLORS.green }] },
        options:{
          responsive:true, maintainAspectRatio:false,
          scales:{
            x:{ grid:{display:false}, ticks:{font:{size:12}} },
            y:{ ticks:{ callback:function(v){ return '₹'+(v/1000).toFixed(0)+'k'; }, font:{size:11} }, grid:{color:'#f1f1f1'} }
          },
          plugins:{
            legend:{ display:false },
            tooltip:{ callbacks:{ label:function(c){ return 'Avg: '+fmtINR(c.parsed.y); }, footer:function(items){ var i=items[0].dataIndex; return counts[i]+' day(s) in range'; } } }
          }
        }
      });
    }

    function renderRecent(){
      var recent = document.getElementById('dashRecent'); if(!recent) return;
      var items = [];
      (S.entries||[]).slice().sort(function(a,b){return (b.date||'').localeCompare(a.date||'');}).slice(0,5).forEach(function(e){
        var C = safeCompute(e);
        var amt = C ? fmtINR((C.today||{}).grossColl || 0) : 'n/a';
        items.push({date:e.date, label:'BO — '+amt+' ('+(e.shows||[]).length+' show(s))'});
      });
      (S.fbEntries||[]).slice().sort(function(a,b){return (b.date||'').localeCompare(a.date||'');}).slice(0,5).forEach(function(e){
        items.push({date:e.date, label:'F&B — '+fmtINR(((e.summary||{}).grossSales||0))+' net'});
      });
      items.sort(function(a,b){return (b.date||'').localeCompare(a.date||'');});
      if(!items.length){ recent.textContent='Nothing yet — start by entering a Box Office day or uploading a DSR.'; return; }
      recent.innerHTML = '<ul style="margin:6px 0 0 18px;padding:0">'+items.slice(0,10).map(function(it){return '<li>'+it.date+' &mdash; '+it.label+'</li>';}).join('')+'</ul>';
    }

    // ---- Top-level render ----
    function render(){
      resolveRange();
      var from = state.from, to = state.to;
      if(!from || !to) return;
      var dates = buildDateList(from, to);

      // Prior period of equal length
      var span = daysBetween(dt(from), dt(to));
      var prevTo = iso(addDays(dt(from), -1));
      var prevFrom = iso(addDays(dt(from), -span));

      var boCur = aggregateBO(from, to);
      var fbCur = aggregateFB(from, to);
      var totalsCur = periodTotals(boCur, fbCur);

      var boPrev = aggregateBO(prevFrom, prevTo);
      var fbPrev = aggregateFB(prevFrom, prevTo);
      var totalsPrev = periodTotals(boPrev, fbPrev);

      renderKPIs(totalsCur, totalsPrev);
      renderRevenueChart(dates, boCur, fbCur);
      renderSphChart(dates, boCur, fbCur);
      var fbItems = aggregateFBItems(from, to);
      renderTopItemsChart(fbItems.byItem);
      renderCategoriesChart(fbItems.byCat);
      renderDowChart(dates, boCur, fbCur);
      if(window.__renderRecentChanges) window.__renderRecentChanges(); else renderRecent();

      // Update range label
      var label = document.getElementById('dashRangeLabel');
      if(label){
        label.textContent = from + ' → ' + to + '  ·  ' + span + ' day' + (span===1?'':'s') + '  ·  vs ' + prevFrom + ' → ' + prevTo;
      }
    }

    // Expose for the global stub
    window.__renderDashboard = render;

    // ---- Range pills ----
    var PRESETS = [
      ['last7',  'Last 7 days'],
      ['last30', 'Last 30 days'],
      ['last90', 'Last 90 days'],
      ['thisMonth', 'This month'],
      ['all',    'All time'],
      ['custom', 'Custom']
    ];
    function renderPills(){
      var host = document.getElementById('dashRangePills'); if(!host) return;
      host.innerHTML = PRESETS.map(function(p){
        var active = state.preset === p[0];
        return '<button class="btn '+(active?'':'ghost')+' sm" data-dashpreset="'+p[0]+'" style="font-weight:600">'+p[1]+'</button>';
      }).join('');
    }
    document.addEventListener('click', function(e){
      var b = e.target.closest && e.target.closest('button[data-dashpreset]');
      if(!b) return;
      state.preset = b.dataset.dashpreset;
      var box = document.getElementById('dashCustomBox');
      if(state.preset === 'custom'){
        if(box) box.style.display = 'flex';
        // Pre-fill custom inputs with current range if available
        var f = document.getElementById('dashFrom'); var t = document.getElementById('dashTo');
        if(f && !f.value && state.from) f.value = state.from;
        if(t && !t.value && state.to) t.value = state.to;
      } else {
        if(box) box.style.display = 'none';
        renderPills();
        render();
      }
    });
    document.addEventListener('click', function(e){
      if(e.target.id !== 'dashCustomApply') return;
      var f = document.getElementById('dashFrom').value;
      var t = document.getElementById('dashTo').value;
      if(!f || !t){ alert('Pick both dates first.'); return; }
      if(f > t){ alert('"From" must be on or before "To".'); return; }
      state.preset = 'custom';
      state.from = f; state.to = t;
      renderPills();
      render();
    });

    // Re-render when the dashboard tab is shown.
    var tabnav = document.getElementById('tabnav');
    if(tabnav){
      tabnav.addEventListener('click', function(e){
        if(e.target.tagName==='BUTTON' && e.target.dataset.tab==='dashboard'){
          setTimeout(function(){ renderPills(); render(); }, 30);
        }
      });
    }

    // Initial paint (in case dashboard is the default visible tab on reload)
    renderPills();
  });
})();
