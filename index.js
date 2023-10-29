/**
 * @license		MIT
 * @date		04.01.2023
 * @copyright   John Brandle
 * 
 * verifies all overrides of a method with a @forceSuperCall JSDoc tag call super
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

const ts = require('typescript');
const path = require('path');

class ForceSuperTransformer 
{
    _program;
    _attributeName;
    _debug;

    _typeChecker;

    _context;
    _currentFile;

    _classNodes = new Map();
    _pendingClassNodes = new Map();
    _failed = false;
    
    constructor(program, attributeName, debug) 
    {
        this._program = program;
        this._attributeName = attributeName;
        this._debug = debug;

        this._typeChecker = this._program.getTypeChecker();
    }
    
    renew()
    {
        if (!this._failed && this._pendingClassNodes.size) 
        {
            console.warn('ForceSuperTransformer failed to process all class nodes:');

            console.warn('classNodes:');
            console.warn(this._classNodes.keys());

            console.warn('pendingClassNodes:');
            console.warn(this._pendingClassNodes.keys());

            console.error(`${this._pendingClassNodes.size} items left in pending queue`);
        }

        this._context = null;
        this._currentFile = null;
        this._classNodes = new Map();
        this._pendingClassNodes = new Map();
        this._failed = false;
    }

    visitSourceFile(context, fileNode) 
    {
        if (this._failed) return fileNode;

        this._context = context;
        this._currentFile = fileNode;
        
        return ts.visitNode(fileNode, this.#visitNode.bind(this));
    }

    #visitNode(node) 
    {
        if (this._failed) return node;
        
        if (ts.isClassDeclaration(node)) 
        {
            this._classNodes.set(`${this._currentFile.fileName}:${node.name.escapedText}`, node);
            this._pendingClassNodes.set(`${this._currentFile.fileName}:${node.name.escapedText}`, node);
        
            this.#processPending();
        }
        
        return ts.visitEachChild(node, this.#visitNode.bind(this), this._context);
    }

    #hasParent(node) 
    {
        if (!node.heritageClauses) return false;

        if (this.#hasJsdocTag(node, 'forceSuperTransformer_ignoreParent'))
        {
            if (this._debug) console.log(`skipping parent lookup for ${node.name.escapedText}`);
            return false;
        } 

        for (let clause of node.heritageClauses) 
        {
            if (clause.token == ts.SyntaxKind.ExtendsKeyword) return true;
        }
    
        return false;
    }

    #getParentClassFullyQualifiedName(node) 
    {
        const getNameFromModuleSpecifier = (symbol, declaration, moduleSpecifier) =>
        {
            const basepath = path.dirname(declaration.getSourceFile().fileName);
            const relativeFilePath = moduleSpecifier.text.replace('.ts', '') + '.ts';
            const extendsFilePath = path.join(basepath, relativeFilePath);
            const parentName = this._typeChecker.getFullyQualifiedName(symbol);
            return `${extendsFilePath}:${parentName}`;
        }
       
        if (!node.heritageClauses) return;

        for (let clause of node.heritageClauses) 
        {
            if (clause.token != ts.SyntaxKind.ExtendsKeyword) continue;

            if (clause.types.length != 1) return console.warn(`error parsing extends expression: ${clause.getText()}`);
            
            let symbol = this._typeChecker.getSymbolAtLocation(clause.types[0].expression);
            if (!symbol) return clause.types[0].expression.getText();
            
            let type = this._typeChecker.getDeclaredTypeOfSymbol(symbol);
            if (!type) return console.warn(`no type associated with symbol for extends expression: ${clause.getText()}`);
            
            let fullyQualifiedName;
            const declaration = symbol.declarations[0];
            if (declaration.parent?.moduleSpecifier)
            {
                fullyQualifiedName = getNameFromModuleSpecifier(symbol, declaration, declaration.parent.moduleSpecifier);
            }
            else //super class is likely defined in the same ts file
            {
                const sourceFile = declaration.getSourceFile();
                for (const statement of sourceFile.statements) 
                {
                    if (!ts.isImportDeclaration(statement)) continue;
                    
                    const importDeclaration = statement;
                    const importClause = importDeclaration.importClause;
    
                    if (!importClause || !importClause.namedBindings || !ts.isNamedImports(importClause.namedBindings)) continue;
    
                    const namedImports = importClause.namedBindings;
    
                    let found = false;
                    for (const element of namedImports.elements) 
                    {
                        if (element.name.text !== symbol.escapedName) continue;
                        
                        found = element;
                        break;
                    }
    
                    if (found === false) continue;
                    
                    fullyQualifiedName = getNameFromModuleSpecifier(symbol, declaration, importDeclaration.moduleSpecifier);
                    break;
                }
      
                if (!fullyQualifiedName) //could not find import. probably because the interface is declared in the same source file 
                {
                    fullyQualifiedName = declaration.getSourceFile().fileName + ':' + symbol.escapedName;
                }
            }

            return fullyQualifiedName;
        }
    
        return;
    }

    #getParentClassNode(classNode)
    {
        let fullyQualifiedName = this.#getParentClassFullyQualifiedName(classNode);
        if (!fullyQualifiedName) return null;

        let result = this._classNodes.get(fullyQualifiedName);
        if (!result && this._debug) console.log(fullyQualifiedName); //it's normal for result to be null, but if there are items pending, then there is probably something wrong with the fullyQualifiedName, and the issue is likely to be found towards the end of these logs

        return result;
    }

    #processPending()
    {
        const isReadyForProcessing = (classNode) => 
        {
            while (this.#hasParent(classNode))
            {
                classNode = this.#getParentClassNode(classNode);
                if (!classNode) return false;
            }

            return true;
        }

        let pending = this._pendingClassNodes;
        for (let [path, classNode] of pending) 
        {
            if (!this.#hasParent(classNode)) //class does not extend anything, remove from pending
            {
                pending.delete(path);
                continue;
            }
            
            if (!isReadyForProcessing(classNode)) continue;

            this.#checkClassMembers(classNode);
            pending.delete(path);
        }
    }

    #checkClassMembers(classNode) 
    {
        for (let member of classNode.members) 
        {
            if (!ts.isMethodDeclaration(member)) continue;
            
            // handle overloads
            let methodNodes = classNode.members.filter(m => ts.isMethodDeclaration(m) && m.name.escapedText === member.name.escapedText);
            
            let requiresSuperCall = this.#requiresSuperCall(classNode, member.name.escapedText);
            let hasSuperCall = methodNodes.some(methodNode => this.#hasSuperCall(methodNode));
            
            if (requiresSuperCall && !hasSuperCall) 
            {
                this._failed = true;
                throw new Error(`Method ${member.name.escapedText} in class ${classNode.name.escapedText} requires a super call but doesn't contain one.`);
            }
        }
    }

    #requiresSuperCall(classNode, methodName) 
    {
        if (this.#methodHasTag(classNode, methodName, this._attributeName)) return false;
     
        while (true) 
        {
            classNode = this.#getParentClassNode(classNode);
            if (!classNode) break;

            if (this.#methodHasTag(classNode, methodName, this._attributeName)) return true;
        }
      
        return false;
    }
      
    #methodHasTag(classNode, methodName, tagName) 
    {
        let methodNodes = classNode.members.filter(member => ts.isMethodDeclaration(member) && member.name.escapedText === methodName);
        return methodNodes.some(methodNode => this.#hasJsdocTag(methodNode, tagName));
    }

    #hasJsdocTag(node, tagName) 
    {
        if (!node.jsDoc) return false;
        for (let jsdoc of node.jsDoc) 
        {
            for (let tag of jsdoc.tags || []) 
            {
                if (tag.tagName.escapedText === tagName) return true;
            }
        }

        return false;
    }

    #hasSuperCall(node) 
    {
        let hasSuperCall = false;

        const visit = (node) => 
        {
            if (hasSuperCall) return;
            
            if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.kind === ts.SyntaxKind.SuperKeyword) 
            {
                hasSuperCall = true;
                return;
            }

            ts.forEachChild(node, visit);
        }

        visit(node);

        return hasSuperCall;
    }
}

let transformers = new Map();
let ID = 0;

module.exports = (program, attributeName='forceSuperTransformer_forceSuperCall', debug=false) => 
{
    if (!program) //renew all transfomers
    {
        for (let [id, transformer] of transformers) transformer.renew();
    }

    let id = ID++;
    return (context) => 
    {
        let transfomer = transformers.get(id);
        if (!transfomer) transformers.set(id, transfomer = new ForceSuperTransformer(program, attributeName, debug));

        return (node) => transfomer.visitSourceFile(context, node);
    };
}