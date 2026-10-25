(function(root){
  'use strict';
  // WebGL handles colour conversion; ten video tags would exceed webOS media limits.
  function CameraRenderer(canvas){
    this.canvas=canvas;var gl=canvas.getContext('webgl',{alpha:false,antialias:false,preserveDrawingBuffer:true});
    if(!gl)throw new Error('WebGL is unavailable');this.gl=gl;this.lost=false;var owner=this;
    canvas.addEventListener('webglcontextlost',function(event){event.preventDefault();owner.lost=true;});
    function shader(type,source){var result=gl.createShader(type);gl.shaderSource(result,source);gl.compileShader(result);if(!gl.getShaderParameter(result,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(result));return result;}
    var program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,'attribute vec2 p; varying vec2 uv; void main(){ gl_Position=vec4(p,0.,1.);uv=vec2((p.x+1.)*.5,(1.-p.y)*.5);}'));
    gl.attachShader(program,shader(gl.FRAGMENT_SHADER,'precision mediump float; varying vec2 uv; uniform sampler2D y; uniform sampler2D u; uniform sampler2D v; uniform float full; void main(){float Y=texture2D(y,uv).r; float U=texture2D(u,uv).r-.5;float V=texture2D(v,uv).r-.5;Y=mix(1.1643*(Y-.062745),Y,full);gl_FragColor=vec4(Y+1.402*V,Y-.344136*U-.714136*V,Y+1.772*U,1.);}'));
    gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('Video shader failed');gl.useProgram(program);this.program=program;
    var buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
    var p=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(p);gl.vertexAttribPointer(p,2,gl.FLOAT,false,0,0);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
    this.textures=['y','u','v'].map(function(name,i){var texture=gl.createTexture();gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.uniform1i(gl.getUniformLocation(program,name),i);return texture;});
    this.full=gl.getUniformLocation(program,'full');
  }
  CameraRenderer.prototype.paint=function(frame){
    var gl=this.gl,canvas=this.canvas;if(this.lost||gl.isContextLost())throw new Error('Video graphics context lost');
    if(canvas.width!==frame.width||canvas.height!==frame.height){canvas.width=frame.width;canvas.height=frame.height;}gl.viewport(0,0,frame.width,frame.height);gl.useProgram(this.program);
    gl.uniform1f(this.full,frame.colour&&frame.colour.fullRange?1:0);
    var lengths=[frame.width*frame.height,frame.width*frame.height/4,frame.width*frame.height/4],offset=0;
    for(var i=0;i<3;i++){gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,this.textures[i]);gl.texImage2D(gl.TEXTURE_2D,0,gl.LUMINANCE,i?frame.width/2:frame.width,i?frame.height/2:frame.height,0,gl.LUMINANCE,gl.UNSIGNED_BYTE,frame.data.subarray(offset,offset+lengths[i]));offset+=lengths[i];}
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  };
  CameraRenderer.prototype.close=function(){var gl=this.gl;this.textures.forEach(function(t){gl.deleteTexture(t);});gl.deleteProgram(this.program);var ext=gl.getExtension('WEBGL_lose_context');if(ext)ext.loseContext();};
  root.CameraRenderer=CameraRenderer;
}(window));
