<script setup lang="ts">
import {
  createDicomWebDataSource,
  type Viewer,
  type ViewportApi,
  type ViewerOptions,
} from '@scope/viewer-core';
import { DicomViewer } from '@scope/viewer-vue';
import { onMounted, shallowRef } from 'vue';

// The installability matrix drives this page through the query string and reads the result
// back from `data-dv-status` and `window.__dv`.
interface Config {
  options: ViewerOptions;
  study: string;
  series: string;
  configUrl: string | undefined;
  configOrigins: string[] | undefined;
}
const config = shallowRef<Config | undefined>(undefined);

onMounted(() => {
  const params = new URLSearchParams(location.search);
  const assets = params.get('assets');
  // A settings file, from the same server as the images in the tests. It needs its origin listed.
  const configUrl = params.get('config') ?? undefined;
  config.value = {
    options: {
      dataSource: createDicomWebDataSource({ wadoRoot: params.get('wadoRoot') ?? '' }),
      assets: assets === null ? { mode: 'inline' } : { mode: 'url', baseUrl: assets },
      cpuRendering: params.has('cpu'),
    },
    study: params.get('study') ?? '',
    series: params.get('series') ?? '',
    configUrl,
    configOrigins: configUrl === undefined ? undefined : [new URL(configUrl, location.href).origin],
  };
});

function onReady(viewer: Viewer, viewport: ViewportApi | undefined): void {
  window.__dv = viewport;
  window.__dvViewer = viewer;
  document.documentElement.dataset['dvStatus'] = 'ready';
}
function onError(error: Error): void {
  window.__dvError = error.message;
  document.documentElement.dataset['dvStatus'] = 'error';
}
</script>

<template>
  <div style="width: 800px; height: 600px">
    <ClientOnly>
      <DicomViewer
        v-if="config"
        :options="config.options"
        :config-url="config.configUrl"
        :config-origins="config.configOrigins"
        :study-instance-uid="config.study"
        :series-instance-uid="config.series"
        @ready="onReady"
        @error="onError"
      />
    </ClientOnly>
  </div>
</template>
