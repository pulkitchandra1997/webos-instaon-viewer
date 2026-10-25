(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.CameraLayout=factory();}(typeof self!=='undefined'?self:this,function(){
  'use strict';
  function fitRect(width,height,ratio,fill){
    if(!(width>0&&height>0&&ratio>0&&Number.isFinite(ratio)))return {width:0,height:0};
    var wider=width/height>ratio;
    return wider!==!!fill?{width:Math.round(height*ratio),height:Math.round(height)}:{width:Math.round(width),height:Math.round(width/ratio)};
  }
  function displayRatio(sar,width,height,override){
    if(override==='16:9')return 16/9;if(override==='4:3')return 4/3;
    var ratio=sar&&sar.numerator>0&&sar.denominator>0?sar.numerator/sar.denominator:1;
    return width*ratio/height;
  }
  return {fitRect:fitRect,displayRatio:displayRatio};
}));
