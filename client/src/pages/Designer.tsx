import { useCallback, useRef, useState, useEffect } from 'react';
import { 
  PlusCircle, 
  Circle, 
  GitCommitHorizontal, 
  Cylinder, 
  ArrowRightCircle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { 
  ReactFlow, 
  Background, 
  Controls, 
  NodeChange,
  EdgeChange,
  Connection,
  Edge,
  Node,
  useReactFlow,
  ReactFlowProvider,
  ControlButton
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { cn } from '@/lib/utils';
import { useNetworkStore, WhamoNode, WhamoEdge } from '@/lib/store';
import { ReservoirNode, SimpleNode, JunctionNode, SurgeTankNode, FlowBoundaryNode } from '@/components/NetworkNode';
import { ConnectionEdge } from '@/components/ConnectionEdge';
import { PropertiesPanel } from '@/components/PropertiesPanel';
import { Header } from '@/components/Header';
import { generateInpFile } from '@/lib/inp-generator';
import { generateSystemDiagram } from '@/lib/diagram-generator';
import { parseInpFile } from '@/lib/inp-parser';
import { saveAs } from 'file-saver';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { 
  Download, 
  X, 
  Maximize2, 
  Minimize2, 
  Tag, 
  EyeOff, 
  Info, 
  ChevronDown, 
  ChevronUp,
  Layout
} from 'lucide-react';
import html2canvas from 'html2canvas';
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const nodeTypes = {
  reservoir: ReservoirNode,
  node: SimpleNode,
  junction: JunctionNode,
  surgeTank: SurgeTankNode,
  flowBoundary: FlowBoundaryNode,
};

const edgeTypes = {
  connection: ConnectionEdge,
};

function DesignerInner() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  // We connect local ReactFlow state to our global Zustand store for properties panel sync
  const { 
    nodes, 
    edges, 
    projectName,
    computationalParams,
    outputRequests,
    onNodesChange: storeOnNodesChange, 
    onEdgesChange: storeOnEdgesChange,
    onConnect: storeOnConnect, 
    selectElement, 
    loadNetwork,
    clearNetwork,
    deleteElement,
    selectedElementId,
    selectedElementType,
    isLocked,
    toggleLock,
    undo,
    redo
  } = useNetworkStore();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Check if user is typing in an input
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }

      // Keyboard shortcuts for zoom and view
      if (event.key === '+' || event.key === '=') {
        zoomIn();
      } else if (event.key === '-' || event.key === '_') {
        zoomOut();
      } else if (event.key.toLowerCase() === 'f') {
        fitView();
      } else if (event.key.toLowerCase() === 'z' && (event.metaKey || event.ctrlKey)) {
        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
        event.preventDefault();
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && 
          selectedElementId && 
          selectedElementType) {
        deleteElement(selectedElementId, selectedElementType);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleteElement, selectedElementId, selectedElementType, zoomIn, zoomOut, fitView, toggleLock]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (isLocked) return;
      storeOnNodesChange(changes);
    },
    [storeOnNodesChange, isLocked]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      if (isLocked) return;
      storeOnEdgesChange(changes);
    },
    [storeOnEdgesChange, isLocked]
  );

  const onConnect = useCallback(
    (params: Connection) => {
      if (isLocked) return;
      if (params.source === params.target) {
        toast({
          variant: "destructive",
          title: "Invalid Connection",
          description: "An element cannot be connected to itself.",
        });
        return;
      }
      storeOnConnect(params);
    },
    [storeOnConnect, toast, isLocked]
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    selectElement(node.id, 'node');
  }, [selectElement]);

  const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    selectElement(edge.id, 'edge');
  }, [selectElement]);

  const onSelectionChange = useCallback(({ nodes, edges }: { nodes: WhamoNode[], edges: WhamoEdge[] }) => {
    if (nodes.length > 0) {
      selectElement(nodes[0].id, 'node');
    } else if (edges.length > 0) {
      selectElement(edges[0].id, 'edge');
    } else {
      selectElement(null, null);
    }
  }, [selectElement]);

  const handleSave = () => {
    const data = { 
      projectName,
      nodes, 
      edges,
      computationalParams,
      outputRequests
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    saveAs(blob, `${projectName.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'network'}_${Date.now()}.json`);
    toast({ title: "Project Saved", description: "Network topology saved to JSON." });
  };

  const handleLoadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const fileName = file.name.toLowerCase();

      try {
        if (fileName.endsWith('.json')) {
          const json = JSON.parse(content);
          if (json.nodes && json.edges) {
            // Use project name from file or fallback to filename
            const loadedProjectName = json.projectName || file.name.replace(/\.json$/i, '');
            loadNetwork(json.nodes, json.edges, json.computationalParams, json.outputRequests, loadedProjectName);
            setHasStarted(true);
            toast({ title: "Project Loaded", description: `Network topology "${loadedProjectName}" restored from JSON.` });
          } else {
            throw new Error("Invalid JSON format");
          }
        } else if (fileName.endsWith('.inp')) {
          const { nodes, edges } = parseInpFile(content);
          if (nodes.length > 0) {
            const loadedProjectName = file.name.replace(/\.inp$/i, '');
            loadNetwork(nodes, edges, undefined, undefined, loadedProjectName);
            setHasStarted(true);
            toast({ title: "Project Loaded", description: `Network topology "${loadedProjectName}" restored from .inp file.` });
          } else {
            throw new Error("No valid network elements found in .inp file");
          }
        } else {
          throw new Error("Unsupported file type");
        }
      } catch (err) {
        toast({ variant: "destructive", title: "Load Failed", description: err instanceof Error ? err.message : "Invalid file." });
      }
    };
    reader.readAsText(file);
    // Reset input
    e.target.value = '';
  };

  const handleGenerateInp = async () => {
    try {
      const inpContent = generateInpFile(nodes, edges);
      
      // Generate system diagram as well
      const diagramHtml = generateSystemDiagram(nodes, edges);
      const diagramBlob = new Blob([diagramHtml], { type: 'text/html' });
      saveAs(diagramBlob, `system_diagram_${Date.now()}.html`);

      const blob = new Blob([inpContent], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const downloadName = (projectName && projectName !== "Untitled Network") ? projectName : "network";
      link.download = `${downloadName}.inp`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      toast({ title: "Files Generated", description: "WHAMO input file and System Diagram downloaded successfully." });
    } catch (err) {
      toast({ variant: "destructive", title: "Generation Failed", description: "Could not generate files. Check connections." });
    }
  };

  const [showDiagram, setShowDiagram] = useState(false);
  const [showShortcutConsole, setShowShortcutConsole] = useState(false);
  const [diagramSvg, setDiagramSvg] = useState<string | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [showLabels, setShowLabels] = useState(true);

  useEffect(() => {
    if (showDiagram) {
      const svg = generateSystemDiagram(nodes, edges, { showLabels });
      setDiagramSvg(svg);
    }
  }, [nodes, edges, showDiagram, showLabels]);

  const downloadImage = async () => {
    const element = document.getElementById('system-diagram-container');
    if (!element) return;
    
    try {
      const canvas = await html2canvas(element, {
        backgroundColor: '#ffffff',
        scale: 2,
      });
      const dataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `system_diagram_${Date.now()}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      toast({ variant: "destructive", title: "Download Failed", description: "Could not generate image." });
    }
  };

  const [isGeneratingOut, setIsGeneratingOut] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);

  useEffect(() => {
    if (nodes.length > 0) {
      setHasStarted(true);
    }
  }, [nodes.length]);

  const handleNewProject = () => {
    clearNetwork();
    setHasStarted(true);
  };

  const handleOpenProject = () => {
    handleLoadClick();
  };

  // Update setHasStarted if loadNetwork is successful
  const originalLoadNetwork = loadNetwork;
  const wrappedLoadNetwork = (...args: any[]) => {
    setHasStarted(true);
    return (originalLoadNetwork as any)(...args);
  };

  const handleGenerateOut = async () => {
    // Create file input element
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.inp';
    
    // Handle file selection
    fileInput.onchange = async (e: any) => {
      const file = e.target.files[0];
      
      if (!file) return;
      
      // Validate file extension
      if (!file.name.endsWith('.inp')) {
        toast({
          variant: "destructive",
          title: "Invalid file",
          description: "Please select a valid .inp file"
        });
        return;
      }
      
      // Show loading state
      setIsGeneratingOut(true);
      
      try {
        // Create form data
        const formData = new FormData();
        formData.append('inpFile', file);
        
        // Call API
        const response = await fetch('/api/generate-out', {
          method: 'POST',
          body: formData
        });
        
        if (!response.ok) {
          throw new Error('Failed to generate OUT file');
        }
        
        // Get the blob
        const blob = await response.blob();
        
        // Trigger download
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name.replace('.inp', '_output.out');
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
        // Show success message
        toast({
          title: "Success",
          description: "OUT file generated successfully!"
        });
        
      } catch (error: any) {
        console.error('Error:', error);
        toast({
          variant: "destructive",
          title: "Generation Failed",
          description: error.message || "Failed to generate OUT file. Please try again."
        });
      } finally {
        setIsGeneratingOut(false);
      }
    };
    
    // Trigger file picker
    fileInput.click();
  };

  useEffect(() => {
    const handleToggleConsole = () => setShowShortcutConsole(prev => !prev);
    window.addEventListener('toggle-shortcut-console', handleToggleConsole);
    return () => window.removeEventListener('toggle-shortcut-console', handleToggleConsole);
  }, []);

  if (!hasStarted && nodes.length === 0) {
    return (
      <div className="flex flex-col h-screen w-full bg-slate-50 items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden">
          <div className="p-8 text-center border-b border-slate-100 bg-slate-50/50">
            <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <PlusCircle className="w-10 h-10 text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 mb-2">
              Welcome to WHAMO
            </h1>
            <p className="text-slate-500 text-sm">
              Hydraulic Transient Analysis Software
            </p>
          </div>
          
          <div className="p-6 space-y-4">
            <Button 
              className="w-full h-14 text-lg font-semibold flex items-center justify-center gap-3 hover-elevate transition-all duration-200"
              onClick={handleNewProject}
              data-testid="button-new-project"
            >
              <PlusCircle className="w-5 h-5" />
              New Project
            </Button>
            
            <Button 
              variant="outline"
              className="w-full h-14 text-lg font-semibold flex items-center justify-center gap-3 hover-elevate transition-all duration-200"
              onClick={handleOpenProject}
              data-testid="button-open-project"
            >
              <Download className="w-5 h-5" />
              Open Project
            </Button>
            
            <div className="pt-4 text-center">
              <p className="text-xs text-slate-400">
                Design, simulate, and analyze water distribution networks.
              </p>
            </div>
          </div>
        </div>
        
        {/* Hidden File Input for Open Project */}
        <input 
          type="file" 
          ref={fileInputRef} 
          onChange={handleFileChange} 
          accept=".json,.inp" 
          className="hidden" 
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden bg-background text-foreground">
      {/* Hidden File Input */}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileChange} 
        accept=".json,.inp" 
        className="hidden" 
      />

      {/* Top Bar (Header) */}
      <Header 
        onExport={handleGenerateInp} 
        onGenerateOut={handleGenerateOut}
        isGeneratingOut={isGeneratingOut}
        onSave={handleSave} 
        onLoad={handleLoadClick} 
        onShowDiagram={() => {
          const svg = generateSystemDiagram(nodes, edges, { showLabels });
          setDiagramSvg(svg);
          setShowDiagram(true);
        }}
      />

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden relative">
        <ResizablePanelGroup direction="vertical">
          <ResizablePanel defaultSize={75} minSize={isMaximized ? 0 : 30} className={cn(isMaximized && "hidden")}>
            <div className="flex h-full w-full overflow-hidden relative">
              {/* Canvas Area */}
              <div className="flex-1 relative h-full bg-slate-50 transition-all duration-300">
                <ReactFlow
                  nodes={nodes as any}
                  edges={edges as any}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onConnect={onConnect}
                  nodeTypes={nodeTypes}
                  edgeTypes={edgeTypes}
                  onNodeClick={onNodeClick}
                  onEdgeClick={onEdgeClick}
                  onSelectionChange={onSelectionChange as any}
                  fitView
                  className="bg-slate-50"
                  proOptions={{ hideAttribution: true }}
                  nodesDraggable={!isLocked}
                  nodesConnectable={!isLocked}
                  elementsSelectable={true}
                >
                  <Background color="#94a3b8" gap={20} size={1} />
                  <Controls className="!bg-white !shadow-xl !border-border">
                  </Controls>
                </ReactFlow>
                
                {isLocked && (
                  <div className="absolute top-4 right-4 bg-orange-100 text-orange-800 px-3 py-1 rounded-md text-sm font-medium border border-orange-200 shadow-sm z-50 flex items-center gap-2">
                    <span className="w-2 h-2 bg-orange-500 rounded-full animate-pulse" />
                    Network Locked
                  </div>
                )}
              </div>

              {/* Properties Panel (Sidebar) */}
              <div 
                className={cn(
                  "h-full border-l border-border bg-card shadow-2xl z-20 flex flex-col transition-all duration-300 ease-in-out overflow-hidden",
                  selectedElementId ? "w-[350px] opacity-100 visible" : "w-0 opacity-0 invisible"
                )}
              >
                <div className="w-[350px] h-full">
                  {selectedElementId && <PropertiesPanel />}
                </div>
              </div>
            </div>
          </ResizablePanel>
          
          {showDiagram && (
            <>
              <ResizableHandle withHandle className={cn(isMaximized && "hidden")} />
              <ResizablePanel defaultSize={25} minSize={isMaximized ? 100 : 10} className={cn(isMaximized && "flex-1")}>
                <div className="h-full w-full bg-background overflow-hidden flex flex-col relative">
                  <div className="flex items-center justify-between p-3 border-b bg-card">
                    <div className="flex items-center gap-6">
                      <div className="flex items-center gap-2">
                        <Info className="w-4 h-4 text-primary" />
                        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">System Diagram Console</h3>
                      </div>
                      
                      {/* Integrated Legend */}
                      <div className="flex items-center gap-4 border-l pl-6">
                        <div className="flex items-center gap-2">
                          <div className="w-4 h-3 bg-[#3498db] border border-[#2980b9] rounded-sm" />
                          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-tight">Reservoir</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-5 bg-[#f39c12] border border-[#e67e22] rounded-sm" />
                          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-tight">Surge Tank</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 bg-[#e74c3c] border border-[#c0392b] rounded-full" />
                          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-tight">Junction</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-0 h-0 border-t-[6px] border-t-transparent border-b-[6px] border-b-transparent border-l-[10px] border-l-[#2ecc71]" />
                          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-tight">Flow BC</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-5 h-0.5 bg-[#3498db]" />
                          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-tight">Conduit</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" onClick={() => setShowLabels(!showLabels)} title={showLabels ? "Hide Labels" : "Show Labels"}>
                        {showLabels ? <EyeOff className="w-4 h-4" /> : <Tag className="w-4 h-4" />}
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setIsMaximized(!isMaximized)} title={isMaximized ? "Restore" : "Maximize"}>
                        {isMaximized ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                      </Button>
                      <Button variant="ghost" size="icon" onClick={downloadImage} title="Download Image">
                        <Download className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => {setShowDiagram(false); setIsMaximized(false);}} title="Close">
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex-1 flex overflow-hidden p-4">
                    <TransformWrapper
                      initialScale={1}
                      minScale={0.5}
                      maxScale={4}
                      centerOnInit
                    >
                      {({ zoomIn, zoomOut, resetTransform }: { zoomIn: () => void, zoomOut: () => void, resetTransform: () => void }) => (
                        <div className="w-full h-full relative group">
                          <div className="absolute bottom-4 left-4 z-10 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button size="icon" variant="secondary" className="w-8 h-8 rounded-full shadow-md" onClick={() => zoomIn()}>+</Button>
                            <Button size="icon" variant="secondary" className="w-8 h-8 rounded-full shadow-md" onClick={() => zoomOut()}>-</Button>
                            <Button size="icon" variant="secondary" className="w-8 h-8 rounded-full shadow-md" onClick={() => resetTransform()}>R</Button>
                          </div>
                          <TransformComponent wrapperClass="!w-full !h-full bg-white rounded-lg shadow-inner border" contentClass="!w-full !h-full">
                            <div 
                              className="w-full h-full flex items-center justify-center p-8 cursor-grab active:cursor-grabbing"
                              id="system-diagram-container"
                              dangerouslySetInnerHTML={{ __html: diagramSvg || '' }}
                            />
                          </TransformComponent>
                        </div>
                      )}
                    </TransformWrapper>
                  </div>
                </div>
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>

        {showShortcutConsole && (
          <div className="absolute bottom-0 left-0 right-0 h-48 bg-slate-900 text-slate-100 z-[100] border-t border-slate-700 font-mono text-sm overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-4 py-2 bg-slate-800 border-b border-slate-700">
              <div className="flex items-center gap-2">
                <Layout className="w-4 h-4" />
                <span className="font-semibold uppercase tracking-wider text-xs">Shortcut Console</span>
              </div>
              <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-400 hover:text-white" onClick={() => setShowShortcutConsole(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex-1 p-4 overflow-y-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-2">
              <div className="flex justify-between border-b border-slate-800 pb-1">
                <span className="text-slate-400">Undo Action</span>
                <span className="text-blue-400">Ctrl + Z</span>
              </div>
              <div className="flex justify-between border-b border-slate-800 pb-1">
                <span className="text-slate-400">Redo Action</span>
                <span className="text-blue-400">Ctrl + Y</span>
              </div>
              <div className="flex justify-between border-b border-slate-800 pb-1">
                <span className="text-slate-400">Open File/Folder</span>
                <span className="text-blue-400">Ctrl + O</span>
              </div>
              <div className="flex justify-between border-b border-slate-800 pb-1">
                <span className="text-slate-400">Save Project</span>
                <span className="text-blue-400">Ctrl + S</span>
              </div>
              <div className="flex justify-between border-b border-slate-800 pb-1">
                <span className="text-slate-400">Cut Element</span>
                <span className="text-blue-400">Ctrl + X</span>
              </div>
              <div className="flex justify-between border-b border-slate-800 pb-1">
                <span className="text-slate-400">Copy Element</span>
                <span className="text-blue-400">Ctrl + C</span>
              </div>
              <div className="flex justify-between border-b border-slate-800 pb-1">
                <span className="text-slate-400">Paste Element</span>
                <span className="text-blue-400">Ctrl + V</span>
              </div>
              <div className="flex justify-between border-b border-slate-800 pb-1">
                <span className="text-slate-400">Select All</span>
                <span className="text-blue-400">Ctrl + A</span>
              </div>
              <div className="flex justify-between border-b border-slate-800 pb-1">
                <span className="text-slate-400">Zoom In</span>
                <span className="text-blue-400">+ / =</span>
              </div>
              <div className="flex justify-between border-b border-slate-800 pb-1">
                <span className="text-slate-400">Zoom Out</span>
                <span className="text-blue-400">- / _</span>
              </div>
              <div className="flex justify-between border-b border-slate-800 pb-1">
                <span className="text-slate-400">Fit to View</span>
                <span className="text-blue-400">F</span>
              </div>
              <div className="flex justify-between border-b border-slate-800 pb-1">
                <span className="text-slate-400">Delete Element</span>
                <span className="text-blue-400">Del / Backspace</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Designer() {
  return (
    <ReactFlowProvider>
      <DesignerInner />
    </ReactFlowProvider>
  );
}
