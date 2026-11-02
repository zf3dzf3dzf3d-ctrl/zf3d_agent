const{createApp}=Vue;
createApp({
    components:{HeaderComponent,FooterComponent},
    data(){
        return{
            files:[],
            cols:6,
            rows:6,
            gap:0,
            tileWidth:90,
            tileHeight:90,
            scale:1,
            x:0,
            y:0,
            drag:null,
            seed:1,
            facing:'right',
            keys:{},
            raf:0
        }
    },
    computed:{
        active(){
            return this.files.filter(f=>f.on)
        },
        safeCols(){
            return this.clamp(Math.floor(Number(this.cols)||1),1,80)
        },
        safeRows(){
            return this.clamp(Math.floor(Number(this.rows)||1),1,80)
        },
        safeGap(){
            return this.clamp(Number(this.gap)||0,0,120)
        },
        safeTileWidth(){
            return this.clamp(Math.floor(Number(this.tileWidth)||90),16,1024)
        },
        safeTileHeight(){
            return this.clamp(Math.floor(Number(this.tileHeight)||90),16,1024)
        },
        total(){
            return this.active.length?this.safeCols*this.safeRows:0
        },
        tiles(){
            const active=this.active;
            if(!active.length||!this.total)return[];
            const out=[];
            let state=(Math.floor(this.seed)||1)>>>0;
            for(let i=0;i<this.total;i++){
                state=(state*1664525+1013904223)>>>0;
                out.push(active[state%active.length]);
            }
            return out
        },
        style(){
            return{
                gridTemplateColumns:'repeat('+this.safeCols+','+this.safeTileWidth+'px)',
                gap:this.safeGap+'px',
                '--tile-width':this.safeTileWidth+'px',
                '--tile-height':this.safeTileHeight+'px',
                transform:'translate('+this.x+'px,'+this.y+'px) scale('+this.scale+')'
            }
        }
    },
    watch:{
        safeCols(){this.queueCenter()},
        safeRows(){this.queueCenter()},
        safeGap(){this.queueCenter()},
        safeTileWidth(){this.queueCenter()},
        safeTileHeight(){this.queueCenter()},
        active(){this.queueCenter()}
    },
    methods:{
        clamp(v,min,max){
            return Math.max(min,Math.min(max,v))
        },
        tileKey(tile,n){
            return tile.id+'-'+n+'-'+this.seed
        },
        queueCenter(){
            this.$nextTick(()=>this.centerGrid())
        },
        centerGrid(){
            const view=this.$refs.view;
            if(!view||!this.active.length)return;
            const rect=view.getBoundingClientRect();
            // Keep the player anchored to the original 6 x 6 visible area.
            const anchorCols=6;
            const anchorRows=6;
            const gridWidth=anchorCols*this.safeTileWidth+(anchorCols-1)*this.safeGap+24;
            const gridHeight=anchorRows*this.safeTileHeight+(anchorRows-1)*this.safeGap+24;
            this.x=(rect.width-gridWidth*this.scale)/2;
            this.y=(rect.height-gridHeight*this.scale)/2
        },
        async load(e){
            const selected=[...e.target.files].filter(file=>file.type.startsWith('image/'));
            const loaded=await Promise.all(selected.map((file,index)=>this.createTile(file,index)));
            this.files.forEach(f=>URL.revokeObjectURL(f.url));
            this.files=loaded;
            this.seed=Date.now()%2147483647||1;
            this.scale=1;
            this.queueCenter();
            e.target.value=''
        },
        createTile(file,index){
            const url=URL.createObjectURL(file);
            return new Promise(resolve=>{
                const image=new Image();
                image.onload=()=>resolve({id:file.name+'-'+file.size+'-'+file.lastModified+'-'+index,url,width:image.naturalWidth,height:image.naturalHeight,on:true});
                image.onerror=()=>resolve({id:file.name+'-'+file.size+'-'+file.lastModified+'-'+index,url,width:0,height:0,on:true});
                image.src=url
            })
        },
        randomizeSeed(){
            this.seed=Math.floor(Math.random()*2147483647)||1
        },
        onWheel(e){
            const oldScale=this.scale;
            const nextScale=this.clamp(oldScale*(e.deltaY>0?.9:1.1),.2,5);
            if(nextScale===oldScale)return;
            const rect=e.currentTarget.getBoundingClientRect();
            const mx=e.clientX-rect.left;
            const my=e.clientY-rect.top;
            const worldX=(mx-this.x)/oldScale;
            const worldY=(my-this.y)/oldScale;
            this.scale=nextScale;
            this.x=mx-worldX*nextScale;
            this.y=my-worldY*nextScale
        },
        down(e){
            if(e.pointerType!=='touch'&&e.button!==1)return;
            e.preventDefault();
            e.currentTarget.setPointerCapture&&e.currentTarget.setPointerCapture(e.pointerId);
            this.drag={id:e.pointerId,x:e.clientX,y:e.clientY,px:this.x,py:this.y}
        },
        move(e){
            if(!this.drag||this.drag.id!==e.pointerId)return;
            e.preventDefault();
            this.x=this.drag.px+e.clientX-this.drag.x;
            this.y=this.drag.py+e.clientY-this.drag.y
        },
        up(e){
            if(this.drag&&this.drag.id===e.pointerId&&e.currentTarget.releasePointerCapture&&e.currentTarget.hasPointerCapture&&e.currentTarget.hasPointerCapture(e.pointerId)){
                e.currentTarget.releasePointerCapture(e.pointerId)
            }
            if(this.drag&&this.drag.id===e.pointerId)this.drag=null
        },
        isTypingTarget(target){
            return target&&/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)
        },
        setKey(e,on){
            if(this.isTypingTarget(e.target))return;
            const key=(e.key||'').toLowerCase();
            if(!['w','a','s','d'].includes(key))return;
            e.preventDefault();
            this.keys[key]=on
        },
        tick(){
            const speed=3;
            if(this.keys.w)this.y+=speed;
            if(this.keys.s)this.y-=speed;
            if(this.keys.a){
                this.x+=speed;
                this.facing='right'
            }
            if(this.keys.d){
                this.x-=speed;
                this.facing='left'
            }
            this.raf=requestAnimationFrame(()=>this.tick())
        }
    },
    mounted(){
        this.onKeyDown=e=>this.setKey(e,true);
        this.onKeyUp=e=>this.setKey(e,false);
        this.onResize=()=>this.centerGrid();
        addEventListener('keydown',this.onKeyDown);
        addEventListener('keyup',this.onKeyUp);
        addEventListener('resize',this.onResize);
        this.tick()
    },
    beforeUnmount(){
        removeEventListener('keydown',this.onKeyDown);
        removeEventListener('keyup',this.onKeyUp);
        removeEventListener('resize',this.onResize);
        cancelAnimationFrame(this.raf);
        this.files.forEach(f=>URL.revokeObjectURL(f.url))
    }
}).mount('#app')