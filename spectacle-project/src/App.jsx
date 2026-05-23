import {
  Deck, Slide, Heading, Text, UnorderedList, OrderedList, ListItem,
  CodePane, Appear, FlexBox, Box, Image,
} from "spectacle"

const theme = {
  "colors": {
    "primary": "#e8e6e3",
    "secondary": "#7dd3fc",
    "tertiary": "#0f1419",
    "quaternary": "#1e2730"
  },
  "fonts": {
    "header": "\"Georgia\", serif",
    "text": "\"Georgia\", serif"
  },
  "fontSizes": {
    "h1": "64px",
    "h2": "44px",
    "text": "26px"
  }
}

export default function App() {
  return (
    <Deck theme={theme}>
      <Slide>
        <FlexBox height="100%" flexDirection="column" justifyContent="center" alignItems="center">
          <Heading>New Deck</Heading>
          <Text style={{ textAlign: "center", opacity: 0.7 }}>Built with deckforge-mcp</Text>
        </FlexBox>
      </Slide>

      <Slide>
        <FlexBox height="100%" flexDirection="column" justifyContent="center" alignItems="center">
          <Heading style={{ fontSize: "64px", fontWeight: "bold" }}>Deckforge</Heading>
          <Text style={{ color: "#6366f1", fontSize: "24px" }}>Build Beautiful Presentations in Seconds</Text>
        </FlexBox>
      </Slide>

      <Slide>
        <FlexBox height="100%" flexDirection="column" justifyContent="flex-start" alignItems="center">
          <Heading>Rich Content Types</Heading>
          <UnorderedList>
            <ListItem>📝 Text & Headings - Format with custom sizes and colors</ListItem>
            <ListItem>📊 Code Blocks - Syntax highlighting for technical content</ListItem>
            <ListItem>🎨 Shapes & Boxes - Visual elements with custom styling</ListItem>
            <ListItem>🖼️ Images - Embed and position media</ListItem>
            <ListItem>📋 Lists & Columns - Organize content flexibly</ListItem>
          </UnorderedList>
        </FlexBox>
      </Slide>

      <Slide>
        <FlexBox height="100%" flexDirection="column" justifyContent="center" alignItems="flex-start">
          <Heading>Flexible Layouts</Heading>
          <Text>Choose how to align content on each slide:\n\n🎯 Center Layout - For titles and focus content\n\n⬅️ Left Layout - For reading-heavy slides\n\n⬆️ Top Layout - For headers with content below</Text>
        </FlexBox>
      </Slide>

      <Slide>
        <FlexBox height="100%" flexDirection="column" justifyContent="center" alignItems="center">
          <Heading>Animations & Transitions</Heading>
          <UnorderedList>
            <ListItem>✨ Click-to-Reveal - Elements appear on demand during presentation</ListItem>
            <ListItem>🔄 Slide Transitions - Fade, Slide, Zoom, or None effects</ListItem>
            <ListItem>⏱️ Timed Animations - Control reveal timing and order</ListItem>
            <ListItem>🎬 Smooth Motion - Professional slide-to-slide movement</ListItem>
          </UnorderedList>
        </FlexBox>
      </Slide>

      <Slide>
        <FlexBox height="100%" flexDirection="column" justifyContent="center" alignItems="center">
          <Heading>Customize & Share</Heading>
          <UnorderedList>
            <ListItem>🎨 Theme Colors - Customize primary, secondary, accent colors globally</ListItem>
            <ListItem>🔄 Reorder Slides - Move slides around on the fly</ListItem>
            <ListItem>📥 Live Dev Server - Preview changes instantly</ListItem>
            <ListItem>📄 Export to PDF - Download your deck for sharing</ListItem>
            <ListItem>🎯 AI-Powered - Build complex decks with natural language</ListItem>
          </UnorderedList>
        </FlexBox>
      </Slide>
    </Deck>
  )
}
