<script setup lang="ts">
import {
  createDicomWebDataSource,
  type LoadedSeries,
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
}
const config = shallowRef<Config | undefined>(undefined);

onMounted(() => {
  const params = new URLSearchParams(location.search);
  const assets = params.get('assets');
  config.value = {
    options: {
      dataSource: createDicomWebDataSource({ wadoRoot: params.get('wadoRoot') ?? '' }),
      assets: assets === null ? { mode: 'inline' } : { mode: 'url', baseUrl: assets },
      cpuRendering: params.has('cpu'),
    },
    study: params.get('study') ?? '',
    series: params.get('series') ?? '',
  };
});

function onReady(series: LoadedSeries): void {
  window.__dv = series;
  document.documentElement.dataset['dvStatus'] = 'ready';
}
function onError(error: Error): void {
  window.__dvError = error.message;
  document.documentElement.dataset['dvStatus'] = 'error';
}
</script>

<template>
  <div style="width: 512px; height: 512px">
    <ClientOnly>
      <DicomViewer
        v-if="config"
        :options="config.options"
        :study-instance-uid="config.study"
        :series-instance-uid="config.series"
        @ready="onReady"
        @error="onError"
      />
    </ClientOnly>
  </div>
</template>
