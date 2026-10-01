/* =====================================================================
   AB2 — texture projector
   Used only by ab2.html.

   Projects a texture onto any MeshStandardMaterial from a fixed "projector"
   camera, the way a slide projector throws an image onto objects in a room.
   Implemented by patching three.js's built-in standard shader
   (onBeforeCompile), so the material keeps its normal lighting and shadows.

   uLit blends between:
     0 → flat: the projected image exactly as-is, no shading. From the
         projector's own viewpoint this is indistinguishable from the page.
     1 → lit: the same image, but shaded and shadowed like a real object,
         which is what exposes the 3D depth.

   Projective texture mapping is a standard graphics technique; this is an
   original implementation written for AB2.
   ===================================================================== */
(function () {
  "use strict";

  var AB2 = (window.AB2 = window.AB2 || {});

  AB2.createProjector = function (THREE, camera, texture) {
    var uniforms = {
      uProjTex: { value: texture },
      uProjView: { value: new THREE.Matrix4() },
      uProjProj: { value: new THREE.Matrix4() },
      uProjPos: { value: new THREE.Vector3() },
      uLit: { value: 0 }
    };

    function applyTo(material) {
      material.onBeforeCompile = function (shader) {
        shader.uniforms.uProjTex = uniforms.uProjTex;
        shader.uniforms.uProjView = uniforms.uProjView;
        shader.uniforms.uProjProj = uniforms.uProjProj;
        shader.uniforms.uProjPos = uniforms.uProjPos;
        shader.uniforms.uLit = uniforms.uLit;

        shader.vertexShader = shader.vertexShader
          .replace(
            "#include <common>",
            [
              "#include <common>",
              "uniform mat4 uProjView;",
              "uniform mat4 uProjProj;",
              "uniform vec3 uProjPos;",
              "varying vec4 vAb2Clip;",
              "varying float vAb2Facing;"
            ].join("\n")
          )
          .replace(
            "#include <begin_vertex>",
            [
              "#include <begin_vertex>",
              "vec4 ab2Local = vec4(transformed, 1.0);",
              "vec3 ab2ObjN = objectNormal;",
              "#ifdef USE_INSTANCING",
              "  ab2Local = instanceMatrix * ab2Local;",
              "  ab2ObjN = mat3(instanceMatrix) * ab2ObjN;",
              "#endif",
              "vec4 ab2World = modelMatrix * ab2Local;",
              "vAb2Clip = uProjProj * uProjView * ab2World;",
              "vec3 ab2N = normalize(mat3(modelMatrix) * ab2ObjN);",
              "vAb2Facing = dot(ab2N, normalize(uProjPos - ab2World.xyz));"
            ].join("\n")
          );

        shader.fragmentShader = shader.fragmentShader
          .replace(
            "#include <common>",
            [
              "#include <common>",
              "uniform sampler2D uProjTex;",
              "uniform float uLit;",
              "varying vec4 vAb2Clip;",
              "varying float vAb2Facing;"
            ].join("\n")
          )
          .replace(
            "#include <color_fragment>",
            [
              "#include <color_fragment>",
              "vec3 ab2Ndc = vAb2Clip.xyz / vAb2Clip.w;",
              "vec2 ab2Uv = ab2Ndc.xy * 0.5 + 0.5;",
              "float ab2In = step(0.0, ab2Uv.x) * step(ab2Uv.x, 1.0)",
              "            * step(0.0, ab2Uv.y) * step(ab2Uv.y, 1.0)",
              "            * step(0.0, vAb2Clip.w);",
              "float ab2Mask = ab2In * step(0.0, vAb2Facing);",
              "vec4 ab2Col = texture2D(uProjTex, clamp(ab2Uv, 0.0, 1.0));",
              "diffuseColor.rgb = mix(diffuseColor.rgb, ab2Col.rgb, ab2Mask * ab2Col.a);",
              "vec3 ab2Flat = diffuseColor.rgb;"
            ].join("\n")
          )
          .replace(
            "#include <opaque_fragment>",
            [
              "#include <opaque_fragment>",
              "gl_FragColor.rgb = mix(ab2Flat, gl_FragColor.rgb, uLit);"
            ].join("\n")
          );
      };
      material.customProgramCacheKey = function () { return "ab2-projected"; };
      material.needsUpdate = true;
    }

    function update() {
      camera.updateMatrixWorld();
      uniforms.uProjView.value.copy(camera.matrixWorldInverse);
      uniforms.uProjProj.value.copy(camera.projectionMatrix);
      uniforms.uProjPos.value.setFromMatrixPosition(camera.matrixWorld);
    }

    return { uniforms: uniforms, applyTo: applyTo, update: update, camera: camera };
  };
})();
