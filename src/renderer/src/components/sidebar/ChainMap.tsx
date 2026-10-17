import { useMemo } from 'react'
import { ReactFlow, Background, Controls, type Edge, type Node, type NodeProps, Handle, Position } from '@xyflow/react'
// ReactFlow 样式表必须显式导入：缺失时节点定位/视口缩放/平移/点击全部失效（连线整体错位就是它）
import '@xyflow/react/dist/style.css'
import dagre from '@dagrejs/dagre'
import type { Mindmap, MindNode } from '@/types'

const LEVEL_COLOR = ['#5b8cff', '#37c99e', '#f5a623', '#ef5b7b', '#9d6bff', '#2bb3d6']

export { LEVEL_COLOR }

/** 链路节点：层级色 + 搜索中动画（尺寸固定，与 dagre 布局参数严格一致） */
function ChainNodeView({ data }: NodeProps) {
  const n = (data as { node: MindNode }).node
  const color = LEVEL_COLOR[(n.level - 1) % LEVEL_COLOR.length]
  return (
    <div className="h-[52px] w-[170px] cursor-pointer rounded-lg border-2 bg-bg-card px-2 py-1 text-xs shadow-md" style={{ borderColor: color }}>
      <Handle type="target" position={Position.Left} style={{ background: color }} />
      <div className="flex items-center gap-1">
        <span className="rounded px-1 text-[9px]" style={{ background: color + '33', color }}>
          L{n.level}
        </span>
        {n.provider && <span className="text-[9px] text-txt-dim">{n.provider}</span>}
        {n.status === 'searching' && <span className="animate-pulse text-[9px] text-accent">拆解中…</span>}
      </div>
      <div className="mt-0.5 line-clamp-2 leading-4">{n.label}</div>
      <Handle type="source" position={Position.Right} style={{ background: color }} />
    </div>
  )
}

/** nodeTypes 必须是模块级常量：内联对象每次渲染重建会触发 ReactFlow 重新测量节点导致连线抖动/错位 */
const NODE_TYPES = { mind: ChainNodeView }

/** 搜索链路图：dagre LR 布局，点击节点回跳该层 */
export function ChainMap({ map, onNodeClick, className }: { map: Mindmap; onNodeClick?: (n: MindNode) => void; className?: string }) {
  const { nodes, edges } = useMemo(() => {
    const g = new dagre.graphlib.Graph()
    g.setGraph({ rankdir: 'LR', nodesep: 24, ranksep: 60 })
    g.setDefaultEdgeLabel(() => ({}))
    for (const n of map.nodes) g.setNode(n.id, { width: 170, height: 52 })
    for (const n of map.nodes) if (n.parentId) g.setEdge(n.parentId, n.id)
    dagre.layout(g)
    return {
      nodes: map.nodes.map((n) => {
        const pos = g.node(n.id)
        // dagre 返回节点中心坐标，ReactFlow 需要左上角 —— 不换算会导致连线锚点错位；
        // 同时给节点声明显式宽高，避免依赖 DOM 实测尺寸产生锚点漂移
        return {
          id: n.id,
          type: 'mind',
          position: { x: (pos?.x ?? 0) - 85, y: (pos?.y ?? 0) - 26 },
          style: { width: 170, height: 52 },
          data: { node: n }
        } satisfies Node
      }),
      edges: map.nodes
        .filter((n) => n.parentId)
        .map((n) => ({ id: `${n.parentId}-${n.id}`, source: n.parentId!, target: n.id, animated: n.status === 'searching' }) satisfies Edge)
    }
  }, [map])

  return (
    <div className={className}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodeClick={(_, n) => {
          const target = map.nodes.find((x) => x.id === n.id)
          if (target) onNodeClick?.(target)
        }}
        fitView
        proOptions={{ hideAttribution: true }}
        minZoom={0.15}
      >
        <Background gap={16} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}

/** 从当前节点回溯到根的路径 */
export function chainPath(map: Mindmap, cur: MindNode): MindNode[] {
  const out: MindNode[] = []
  let n: MindNode | undefined = cur
  while (n) {
    out.unshift(n)
    n = n.parentId ? map.nodes.find((x) => x.id === n!.parentId) : undefined
  }
  return out
}
