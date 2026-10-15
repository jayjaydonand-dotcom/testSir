<template>
  <div>
    <div
      class="tree-item"
      :class="{ active: selected === node.iri }"
      @click="$emit('select', node.iri)"
    >
      {{ node.label }}
    </div>
    <div v-if="node.children && node.children.length" class="tree-children">
      <ClassTreeNode
        v-for="child in node.children"
        :key="child.iri"
        :node="child"
        :selected="selected"
        @select="$emit('select', $event)"
      />
    </div>
  </div>
</template>

<script setup>
defineOptions({ name: 'ClassTreeNode' })
defineProps({
  node: { type: Object, required: true },
  selected: { type: String, default: null }
})
defineEmits(['select'])
</script>
