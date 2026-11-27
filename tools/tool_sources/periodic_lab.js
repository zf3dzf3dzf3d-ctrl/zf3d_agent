const { createApp } = Vue;
createApp({components:{HeaderComponent,FooterComponent,CookieConsent}}).mount('#app');

(() => {
    const categoryLabels = {
        alkali: '碱金属',
        alkaline: '碱土金属',
        transition: '过渡金属',
        post: '后过渡金属',
        metalloid: '类金属',
        nonmetal: '非金属',
        halogen: '卤素',
        noble: '稀有气体',
        lanthanide: '镧系',
        actinide: '锕系'
    };
    const categoryBase = {
        alkali: {reactivity: 9, vibe: '爆闪、飞溅、离子风暴'},
        alkaline: {reactivity: 7, vibe: '白光、热浪、气泡'},
        transition: {reactivity: 5, vibe: '金属光、氧化壳、合金纹'},
        post: {reactivity: 4, vibe: '熔珠、柔光、低速变形'},
        metalloid: {reactivity: 4, vibe: '晶格、半导体闪烁'},
        nonmetal: {reactivity: 6, vibe: '火焰、烟雾、分子云'},
        halogen: {reactivity: 8, vibe: '彩雾、腐蚀光环'},
        noble: {reactivity: 1, vibe: '围观、霓虹、漂浮'},
        lanthanide: {reactivity: 6, vibe: '稀土辉光、磁性波纹'},
        actinide: {reactivity: 7, vibe: '重核光晕、能量脉冲'}
    };
    const elements = [
        [1,'H','氢','nonmetal',1,1,8,'轻到像宇宙火花'],[2,'He','氦','noble',18,1,1,'粉色霓虹气泡'],
        [3,'Li','锂','alkali',1,2,8,'淡红爆闪'],[4,'Be','铍','alkaline',2,2,4,'坚硬冷光'],[5,'B','硼','metalloid',13,2,4,'绿色晶格'],[6,'C','碳','nonmetal',14,2,5,'黑钻与火星'],[7,'N','氮','nonmetal',15,2,3,'冷蓝气幕'],[8,'O','氧','nonmetal',16,2,9,'火焰放大器'],[9,'F','氟','halogen',17,2,10,'紫白利刃'],[10,'Ne','氖','noble',18,2,1,'广告牌霓虹'],
        [11,'Na','钠','alkali',1,3,10,'金色爆点'],[12,'Mg','镁','alkaline',2,3,8,'白色闪光弹'],[13,'Al','铝','post',13,3,6,'银白氧化膜'],[14,'Si','硅','metalloid',14,3,4,'芯片晶格'],[15,'P','磷','nonmetal',15,3,8,'幽绿火焰'],[16,'S','硫','nonmetal',16,3,6,'黄雾火舌'],[17,'Cl','氯','halogen',17,3,9,'黄绿雾环'],[18,'Ar','氩','noble',18,3,1,'蓝紫保护罩'],
        [19,'K','钾','alkali',1,4,10,'紫色爆闪'],[20,'Ca','钙','alkaline',2,4,7,'白灰火花'],[21,'Sc','钪','transition',3,4,5,'银色火线'],[22,'Ti','钛','transition',4,4,4,'彩色氧化膜'],[23,'V','钒','transition',5,4,5,'多彩离子'],[24,'Cr','铬','transition',6,4,4,'镜面护甲'],[25,'Mn','锰','transition',7,4,6,'紫黑粉尘'],[26,'Fe','铁','transition',8,4,7,'红热火花'],[27,'Co','钴','transition',9,4,5,'蓝磁光'],[28,'Ni','镍','transition',10,4,4,'硬币亮面'],[29,'Cu','铜','transition',11,4,6,'红铜绿焰'],[30,'Zn','锌','transition',12,4,7,'蓝白烟'],[31,'Ga','镓','post',13,4,4,'低温熔珠'],[32,'Ge','锗','metalloid',14,4,4,'半导体镜片'],[33,'As','砷','metalloid',15,4,6,'危险灰雾'],[34,'Se','硒','nonmetal',16,4,5,'红色玻璃光'],[35,'Br','溴','halogen',17,4,8,'棕红蒸汽'],[36,'Kr','氪','noble',18,4,1,'冷白闪电'],
        [37,'Rb','铷','alkali',1,5,10,'红紫爆点'],[38,'Sr','锶','alkaline',2,5,8,'烟火红光'],[39,'Y','钇','transition',3,5,5,'稀土白光'],[40,'Zr','锆','transition',4,5,5,'陶瓷火线'],[41,'Nb','铌','transition',5,5,4,'冷蓝金属'],[42,'Mo','钼','transition',6,5,4,'硬核银灰'],[43,'Tc','锝','transition',7,5,6,'虚拟核光'],[44,'Ru','钌','transition',8,5,3,'暗银护甲'],[45,'Rh','铑','transition',9,5,3,'高亮镜面'],[46,'Pd','钯','transition',10,5,3,'吸氢海绵'],[47,'Ag','银','transition',11,5,4,'月光金属'],[48,'Cd','镉','transition',12,5,5,'冷色烟尘'],[49,'In','铟','post',13,5,4,'柔软银滴'],[50,'Sn','锡','post',14,5,4,'低熔白金'],[51,'Sb','锑','metalloid',15,5,4,'脆亮晶体'],[52,'Te','碲','metalloid',16,5,4,'银灰鳞片'],[53,'I','碘','halogen',17,5,7,'紫色蒸汽'],[54,'Xe','氙','noble',18,5,1,'电离闪光'],
        [55,'Cs','铯','alkali',1,6,10,'金色液滴爆闪'],[56,'Ba','钡','alkaline',2,6,8,'绿色烟火'],[72,'Hf','铪','transition',4,6,4,'重金属护壳'],[73,'Ta','钽','transition',5,6,3,'耐热灰蓝'],[74,'W','钨','transition',6,6,3,'白热灯芯'],[75,'Re','铼','transition',7,6,3,'高温银脊'],[76,'Os','锇','transition',8,6,3,'沉重蓝灰'],[77,'Ir','铱','transition',9,6,2,'稳定星核'],[78,'Pt','铂','transition',10,6,2,'冷白贵金属'],[79,'Au','金','transition',11,6,1,'金色核心'],[80,'Hg','汞','transition',12,6,5,'银色液球'],[81,'Tl','铊','post',13,6,5,'暗灰软光'],[82,'Pb','铅','post',14,6,4,'重盾灰光'],[83,'Bi','铋','post',15,6,3,'彩虹晶阶'],[84,'Po','钋','post',16,6,6,'虚拟热尘'],[85,'At','砹','halogen',17,6,7,'暗紫卤影'],[86,'Rn','氡','noble',18,6,1,'沉重气泡'],
        [87,'Fr','钫','alkali',1,7,10,'放射性极强的碱金属，仅能以痕量短暂存在。'],[88,'Ra','镭','alkaline',2,7,8,'具强放射性，历史上曾用于夜光材料，现受严格管控。'],[104,'Rf','鑪','transition',4,7,5,'人工合成的超重元素，寿命极短，物性主要来自理论预测。'],[105,'Db','𨧀','transition',5,7,5,'人工合成的超重元素，已知样品极少。'],[106,'Sg','𨭎','transition',6,7,5,'人工合成的超重元素，研究重点是其化学性质。'],[107,'Bh','𨨏','transition',7,7,5,'人工合成的放射性元素，寿命很短。'],[108,'Hs','𨭆','transition',8,7,5,'人工合成的放射性元素，宏观物性尚难直接测定。'],[109,'Mt','鿏','transition',9,7,5,'人工合成的超重元素，仅在粒子实验中获得。'],[110,'Ds','鐽','transition',10,7,5,'人工合成的超重元素，研究样品极少。'],[111,'Rg','錀','transition',11,7,5,'人工合成的超重元素，可能具有金属特征。'],[112,'Cn','鎶','transition',12,7,4,'人工合成的超重元素，化学性质仍在研究。'],[113,'Nh','鉨','post',13,7,4,'人工合成的超重元素，寿命极短。'],[114,'Fl','鈇','post',14,7,4,'人工合成的超重元素，性质主要依赖理论与原子级实验。'],[115,'Mc','鏌','post',15,7,4,'人工合成的超重元素，已知化学数据有限。'],[116,'Lv','鉝','post',16,7,4,'人工合成的超重元素，放射性强且寿命很短。'],[117,'Ts','鿬','halogen',17,7,6,'人工合成的卤素族元素，性质尚在探索。'],[118,'Og','鿫','noble',18,7,1,'人工合成的稀有气体族元素，寿命极短。'],
        [57,'La','镧','lanthanide',4,8,6,'稀土白光'],[58,'Ce','铈','lanthanide',5,8,6,'火石亮点'],[59,'Pr','镨','lanthanide',6,8,6,'绿色玻璃'],[60,'Nd','钕','lanthanide',7,8,6,'强磁紫光'],[61,'Pm','钷','lanthanide',8,8,6,'虚拟蓝火'],[62,'Sm','钐','lanthanide',9,8,5,'磁粉光'],[63,'Eu','铕','lanthanide',10,8,6,'红色荧光'],[64,'Gd','钆','lanthanide',11,8,6,'磁性脉冲'],[65,'Tb','铽','lanthanide',12,8,5,'绿色发光'],[66,'Dy','镝','lanthanide',13,8,5,'银灰磁弧'],[67,'Ho','钬','lanthanide',14,8,5,'激光粉光'],[68,'Er','铒','lanthanide',15,8,5,'玫红光纤'],[69,'Tm','铥','lanthanide',16,8,5,'蓝色微光'],[70,'Yb','镱','lanthanide',17,8,5,'柔亮银珠'],[71,'Lu','镥','lanthanide',18,8,4,'稀土终点'],
        [89,'Ac','锕','actinide',4,9,7,'重核蓝雾'],[90,'Th','钍','actinide',5,9,6,'白色陶核'],[91,'Pa','镤','actinide',6,9,7,'金属能带'],[92,'U','铀','actinide',7,9,7,'绿色重核'],[93,'Np','镎','actinide',8,9,7,'暗银核光'],[94,'Pu','钚','actinide',9,9,7,'红热核心'],[95,'Am','镅','actinide',10,9,7,'烟雾报警光'],[96,'Cm','锔','actinide',11,9,7,'紫色粒子'],[97,'Bk','锫','actinide',12,9,7,'微型星点'],[98,'Cf','锎','actinide',13,9,7,'高能火花'],[99,'Es','锿','actinide',14,9,7,'短寿辉光'],[100,'Fm','镄','actinide',15,9,7,'重核闪烁'],[101,'Md','钔','actinide',16,9,7,'人工星尘'],[102,'No','锘','actinide',17,9,7,'深蓝核影'],[103,'Lr','铹','actinide',18,9,7,'锕系尾焰']
    ].map(item => ({number:item[0], symbol:item[1], name:item[2], category:item[3], x:item[4], y:item[5], reactivity:item[6], vibe:item[7]}));
    const bySymbol = Object.fromEntries(elements.map(item => [item.symbol, item]));
    const scientificDescriptions = {
        Li:'最轻的金属之一，是锂离子电池和轻质合金的重要材料。', Be:'轻而硬的金属，常用于航空航天和精密仪器部件。', Na:'柔软且反应活泼的碱金属，常以化合物形式存在。', Mg:'密度低、燃烧时发强白光，常用于轻合金。', Al:'密度低且耐腐蚀，是最常用的结构金属之一。', K:'反应性很高的碱金属，常见于肥料和生物体电解质。', Ca:'活泼碱土金属，广泛以矿物形式存在。', Sc:'稀有轻金属，可改善铝合金性能。', Ti:'强度高、耐腐蚀，常用于航空、医疗植入物和化工设备。', V:'可提高合金强度，常用于特种钢。', Cr:'耐腐蚀性强，是不锈钢和镀铬材料的重要成分。', Mn:'炼钢常用元素，可提升钢的强度和耐磨性。', Fe:'最重要的工业金属之一，是钢铁材料的基础。', Co:'具有磁性，常用于高温合金、电池和磁性材料。', Ni:'耐腐蚀且可形成合金，是不锈钢的重要成分。', Cu:'导电和导热性能优良，广泛用于电线、电机和管材。', Zn:'常用于镀锌防腐，也可制成多种合金。', Ga:'熔点较低，重要用途是半导体材料。', Rb:'极活泼的碱金属，主要用于科研和精密仪器。', Sr:'碱土金属，其化合物可用于烟火的红色焰色。', Y:'稀土相关金属，常用于激光、荧光和高性能材料。', Zr:'耐腐蚀、耐高温，常用于核工业和耐火材料。', Nb:'可增强合金强度，也用于超导材料。', Mo:'耐高温金属，常用于合金钢和催化材料。', Tc:'人工合成的放射性元素，医学成像中有重要同位素应用。', Ru:'铂族金属，可用于催化剂和电子材料。', Rh:'耐腐蚀的铂族金属，常用于汽车尾气催化。', Pd:'铂族金属，具有吸氢能力，常用于催化和氢相关研究。', Ag:'导电性很高，常用于电子、电接点和抗菌材料。', Cd:'有毒重金属，现多受限使用于电池和颜料等领域。', In:'较软的金属，氧化铟锡是透明导电材料。', Sn:'熔点较低，常用于焊料、镀层和合金。', Cs:'反应性极高的碱金属，可用于原子钟等精密设备。', Ba:'碱土金属，其化合物用于钻井液和医学造影。', La:'镧系金属，常用于光学玻璃和储氢合金。', Ce:'最常见的稀土元素之一，常用于催化剂和抛光粉。', Pr:'稀土金属，可用于高性能磁体和特种玻璃。', Nd:'强永磁材料的关键元素，广泛用于电机和风电设备。', Pm:'人工放射性元素，主要用于科研。', Sm:'可制成耐高温的稀土永磁材料。', Eu:'荧光性能突出，常用于显示和防伪材料。', Gd:'磁性强，可用于磁共振成像造影剂和核技术。', Tb:'可产生绿色荧光，也用于磁致伸缩材料。', Dy:'可提高永磁体在高温下的稳定性。', Ho:'磁矩很高，主要用于激光和磁性研究。', Er:'常用于光纤通信中的信号放大材料。', Tm:'稀有稀土元素，主要用于科研和特种光学材料。', Yb:'可用于激光材料和原子物理研究。', Lu:'密度较高的稀土金属，用于闪烁晶体和催化研究。', Hf:'耐高温且吸收中子，可用于核控制材料。', Ta:'耐腐蚀性很强，常用于电子电容器和化工设备。', W:'熔点极高，常用于硬质合金和高温部件。', Re:'耐高温稀有金属，常用于航空发动机高温合金。', Os:'密度很高的铂族金属，四氧化锇具有毒性和挥发性。', Ir:'极耐腐蚀的铂族金属，用于高温和特种电极材料。', Pt:'稳定且耐腐蚀的铂族金属，广泛用于催化和珠宝。', Au:'化学性质稳定、延展性好，常用于电子和贵金属材料。', Hg:'常温下为液态的金属，具有毒性并受严格限制。', Tl:'有毒重金属，化合物具有较高毒性。', Pb:'密度大且易加工，但有毒，使用受到严格限制。', Bi:'较低毒性的重金属，可用于低熔点合金和医药材料。', Po:'强放射性元素，存在量极少。', Ra:'强放射性碱土金属，历史上用于夜光材料。', Ac:'放射性锕系金属，主要用于科研和核医学研究。', Th:'放射性锕系金属，可作为核燃料研究对象。', Pa:'稀有放射性元素，主要用于基础研究。', U:'放射性重金属，可用于核燃料和材料研究。', Np:'人工或痕量存在的放射性锕系元素。', Pu:'放射性锕系元素，在核技术中具有重要性。', Am:'人工放射性元素，部分同位素用于工业检测。', Cm:'人工放射性锕系元素，主要用于科研。', Bk:'人工合成的放射性元素。', Cf:'人工放射性元素，可作为中子源。', Es:'人工合成的放射性元素，产量极低。', Fm:'人工合成的放射性元素，仅用于科研。', Md:'人工合成的放射性元素，寿命很短。', No:'人工合成的放射性元素，主要用于基础研究。', Lr:'人工合成的锕系元素，化学性质仍在研究。'
    };
    const categoryDescriptions = {
        alkali:'碱金属通常质软、密度较低，并具有较高的化学反应性。', alkaline:'碱土金属通常为银白色金属，反应性低于碱金属。', transition:'过渡金属通常导电性良好，并可呈现多种氧化态。', post:'后过渡金属的物理和化学性质因元素而有明显差异。', metalloid:'类金属兼具金属与非金属的一些特征，常与半导体材料相关。', nonmetal:'非金属的性质差异很大，常以分子或共价网络形式存在。', halogen:'卤素通常具有较强反应性，易形成盐类化合物。', noble:'稀有气体在常见条件下化学反应性很低。', lanthanide:'镧系金属常用于磁性、发光、催化和光学材料。', actinide:'锕系元素均具放射性，相关研究需要严格专业条件。'
    };
    const state = {selected:[], focused:bySymbol.H, calculating:false, resultText:'', resultElements:'', savedResultId:0};
    const table = document.getElementById('plab-table'), strip = document.getElementById('plab-strip'), resultBox = document.getElementById('plab-result'), status = document.getElementById('plab-status'), hoverCard = document.getElementById('plab-hover-card');

    function text(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])); }
    function renderInlineMarkdown(value) {
        return text(value)
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\x60([^\x60]+)\x60/g, '<code>$1</code>');
    }
    function renderAiMarkdown(value) {
        const lines = String(value == null ? '' : value).replace(/\r/g, '').split('\n');
        let html = '', inList = false;
        const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
        lines.forEach(rawLine => {
            const line = rawLine.trim();
            if (!line) { closeList(); return; }
            const bullet = line.match(/^[-*]\s+(.+)$/);
            if (bullet) {
                if (!inList) { html += '<ul>'; inList = true; }
                html += '<li>' + renderInlineMarkdown(bullet[1]) + '</li>';
                return;
            }
            closeList();
            const heading = line.match(/^(?:#{1,3}\s+|\*\*)(.+?)(?:\*\*)?[:：]?$/);
            html += heading && (/^#{1,3}\s+/.test(line) || /^\*\*.+\*\*[:：]?$/.test(line))
                ? '<h3>' + renderInlineMarkdown(heading[1]) + '</h3>'
                : '<p>' + renderInlineMarkdown(line) + '</p>';
        });
        closeList();
        return html || '<p>AI 没有返回结果。</p>';
    }
    function setStatus(message) { status.textContent = message || ''; }
    function syncResultActions() {
        const hasResult = !!state.resultText;
        const copyButton = document.getElementById('plab-copy');
        const saveButton = document.getElementById('plab-save');
        copyButton.disabled = !hasResult;
        saveButton.disabled = !hasResult || !!state.savedResultId;
        saveButton.textContent = state.savedResultId ? '已保存' : '保存到我的结果';
    }

    function renderTable() {
        table.innerHTML = '';
        elements.forEach(element => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'plab-element cat-' + element.category;
            button.style.gridColumn = element.x;
            button.style.gridRow = element.y;
            button.dataset.symbol = element.symbol;
            button.innerHTML = '<span class="num">' + element.number + '</span><span class="sym">' + text(element.symbol) + '</span><span class="name">' + text(element.name) + '</span>';
            button.addEventListener('click', () => toggleElement(element.symbol));
            button.addEventListener('mouseenter', event => showPreview(element, event));
            button.addEventListener('mousemove', movePreview);
            button.addEventListener('mouseleave', hidePreview);
            button.addEventListener('focus', () => showPreviewAtElement(element, button));
            button.addEventListener('blur', hidePreview);
            table.appendChild(button);
        });
    }
    function renderStrip() {
        document.getElementById('plab-count').textContent = state.selected.length + ' 个元素已选';
        strip.innerHTML = '';
        if (!state.selected.length) {
            strip.innerHTML = '<span class="plab-empty">元素槽为空</span>';
        } else {
            state.selected.forEach((symbol, index) => {
                if (index > 0) strip.insertAdjacentHTML('beforeend', '<span class="plab-plus">+</span>');
                const element = bySymbol[symbol];
                const chip = document.createElement('span');
                chip.className = 'plab-chip';
                chip.innerHTML = text(element.name) + '<button type="button" title="移除">×</button>';
                chip.querySelector('button').addEventListener('click', () => removeElement(symbol));
                strip.appendChild(chip);
            });
        }
        if (state.selected.length) strip.insertAdjacentHTML('beforeend', '<span class="plab-eq">=</span>');
    }
    function previewMarkup(element) {
        const description = scientificDescriptions[element.symbol] || categoryDescriptions[element.category] || '该元素的宏观性质仍需结合具体条件判断。';
        return '<div class="plab-hover-head"><span class="plab-hover-symbol">' + text(element.symbol) + '</span><div><h3>' + text(element.name) + '</h3><p>' + text(description) + '</p></div></div><div class="plab-hover-meta"><span><b>原子序数</b>' + element.number + '</span><span><b>分类</b>' + text(categoryLabels[element.category] || element.category) + '</span><span><b>活泼度</b>' + element.reactivity + ' / 10</span><span><b>研究提示</b>' + text(element.number >= 104 ? '样品极少，性质多待验证' : '性质随物态和条件变化') + '</span></div>';
    }
    function placePreview(x, y) {
        const gap = 14, width = hoverCard.offsetWidth || 280, height = hoverCard.offsetHeight || 180;
        let left = x + gap, top = y + gap;
        if (left + width > window.innerWidth - 16) left = x - width - gap;
        if (top + height > window.innerHeight - 16) top = window.innerHeight - height - 16;
        hoverCard.style.left = Math.max(16, left) + 'px';
        hoverCard.style.top = Math.max(16, top) + 'px';
    }
    function showPreview(element, event) {
        state.focused = element;
        hoverCard.innerHTML = previewMarkup(element);
        hoverCard.hidden = false;
        placePreview(event.clientX, event.clientY);
        syncActiveCells();
    }
    function showPreviewAtElement(element, button) {
        const rect = button.getBoundingClientRect();
        showPreview(element, {clientX:rect.left + rect.width / 2, clientY:rect.top + rect.height / 2});
    }
    function movePreview(event) { if (!hoverCard.hidden) placePreview(event.clientX, event.clientY); }
    function hidePreview() { hoverCard.hidden = true; }
    function syncActiveCells() {
        document.querySelectorAll('.plab-element').forEach(button => {
            button.classList.toggle('active', state.selected.includes(button.dataset.symbol));
            button.classList.toggle('focused', state.focused && state.focused.symbol === button.dataset.symbol);
        });
    }
    function renderAll() {
        renderStrip();
        syncActiveCells();
    }
    function focusElement(symbol) {
        state.focused = bySymbol[symbol] || state.focused;
        syncActiveCells();
    }
    function toggleElement(symbol) {
        focusElement(symbol);
        if (state.selected.includes(symbol)) removeElement(symbol);
        else {
            if (state.selected.length >= 8) {
                setStatus('反应槽最多放 8 个元素。');
                return;
            }
            state.selected.push(symbol);
            renderAll();
            setStatus(symbol + ' 已加入反应槽。');
        }
    }
    function removeElement(symbol) {
        state.selected = state.selected.filter(item => item !== symbol);
        renderAll();
    }
    function clearAll() {
        state.selected = [];
        state.resultText = '';
        state.resultElements = '';
        state.savedResultId = 0;
        renderAll();
        resultBox.innerHTML = '<h3>等待 AI 演算</h3><p>选择元素后按等号。</p>';
        syncResultActions();
        setStatus('');
    }
    function undo() {
        state.selected.pop();
        renderAll();
    }
    function calculateLocal() {
        const selected = state.selected.map(symbol => bySymbol[symbol]).filter(Boolean);
        if (!selected.length) return null;
        return {
            payload: {
                elements: selected.map(item => ({name:item.name})),
                analysis_mode: 'automatic'
            }
        };
    }
    function renderResult(aiText) {
        if (!aiText) {
            resultBox.innerHTML = '<h3>反应槽为空</h3><p>先点几个元素。</p>';
            return;
        }
        resultBox.innerHTML = '<div class="plab-ai">' + renderAiMarkdown(aiText) + '</div>';
    }
    async function copyResult() {
        if (!state.resultText) return;
        try {
            await navigator.clipboard.writeText(state.resultText);
        } catch (error) {
            const field = document.createElement('textarea');
            field.value = state.resultText;
            document.body.appendChild(field);
            field.select();
            document.execCommand('copy');
            field.remove();
        }
        setStatus('计算结果已复制。');
    }
    async function saveResult() {
        if (!state.resultText || state.savedResultId) return;
        const saveButton = document.getElementById('plab-save');
        saveButton.disabled = true;
        saveButton.textContent = '保存中';
        try {
            const body = new URLSearchParams({element_names:state.resultElements, result_text:state.resultText});
            const response = await fetch('/api/tool_api.asp?a=periodic_lab_result_save', {
                method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'}, body
            });
            const payload = await response.json();
            if (!payload.success) throw new Error(payload.message || '保存失败');
            state.savedResultId = Number(payload.data && payload.data.id) || 1;
            setStatus('已保存到我的结果。');
        } catch (error) {
            setStatus(error.message || '保存失败。');
        } finally {
            syncResultActions();
        }
    }
    async function calculate() {
        if (state.calculating) return;
        const local = calculateLocal();
        if (!local) {
            renderResult('');
            return;
        }
        state.calculating = true;
        state.resultText = '';
        state.resultElements = local.payload.elements.map(item => item.name).join('、');
        state.savedResultId = 0;
        syncResultActions();
        document.getElementById('plab-equals').textContent = 'AI 演算中';
        renderResult('AI 正在演算...');
        setStatus('正在请求 AI 幻想演算。');
        try {
            const body = new URLSearchParams({
                selection: JSON.stringify(local.payload),
                base_result: '请只按玩家选择的中文元素名，自动推演可能的结合方式。'
            });
            const response = await fetch('/api/tool_api.asp?a=periodic_lab_explain', {
                method: 'POST',
                credentials: 'same-origin',
                headers: {'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},
                body
            });
            const payload = await response.json();
            if (!payload.success) throw new Error(payload.message || 'AI 演算失败');
            state.resultText = payload.data && payload.data.explanation ? payload.data.explanation : 'AI 没有返回结果。';
            renderResult(state.resultText);
            syncResultActions();
            setStatus(typeof payload.data.token_balance !== 'undefined' ? 'AI 演算完成，剩余 ' + payload.data.token_balance + ' 次。' : 'AI 演算完成。');
        } catch (error) {
            renderResult('AI 演算失败：' + (error.message || '请求失败'));
            setStatus(error.message || 'AI 请求失败。');
        } finally {
            state.calculating = false;
            document.getElementById('plab-equals').textContent = '= AI 演算';
        }
    }

    renderTable();
    renderAll();
    document.getElementById('plab-clear').addEventListener('click', clearAll);
    document.getElementById('plab-undo').addEventListener('click', undo);
    document.getElementById('plab-equals').addEventListener('click', () => calculate(false));
    document.getElementById('plab-copy').addEventListener('click', copyResult);
    document.getElementById('plab-save').addEventListener('click', saveResult);
    syncResultActions();
})();
