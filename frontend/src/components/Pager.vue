<template>
  <div v-if="total > pageSize" class="actions" style="margin:0.4rem 0 1rem;align-items:center">
    <span class="muted">共 {{ total }} 条 · 第 {{ page }} / {{ pages }} 页</span>
    <button :disabled="page <= 1" @click="$emit('update:page', page - 1)">上一页</button>
    <button :disabled="page >= pages" @click="$emit('update:page', page + 1)">下一页</button>
  </div>
  <div v-else-if="total > 0" class="muted" style="margin:0.2rem 0 0.8rem">共 {{ total }} 条</div>
</template>

<script setup>
import { computed } from 'vue'
import { PAGE_SIZE } from '../ontology/constants'

const props = defineProps({
  total: { type: Number, default: 0 },
  page: { type: Number, default: 1 },
  pageSize: { type: Number, default: PAGE_SIZE }
})
defineEmits(['update:page'])
const pages = computed(() => Math.max(1, Math.ceil((props.total || 0) / props.pageSize) || 1))
</script>
